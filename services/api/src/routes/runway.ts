import { Router } from "express";
import { RunwayController } from "../controllers/runway.controller";
import { authMiddleware } from "../middleware/auth";
import { prisma } from "../services/prisma";
import { redisConnection } from "../queues/runway.queue";
import fs from "fs";
import path from "path";

const ctrl = new RunwayController();
export const runwayRouter = Router();

// Jobs routes — require auth
runwayRouter.post("/jobs", authMiddleware, (req, res) => ctrl.createJob(req, res));
runwayRouter.post("/jobs/batch", authMiddleware, (req, res) => ctrl.batchCreateJobs(req, res));
runwayRouter.get("/jobs", authMiddleware, (req, res) => ctrl.listJobs(req, res));
runwayRouter.get("/jobs/:id", authMiddleware, (req, res) => ctrl.getJob(req, res));
runwayRouter.post("/jobs/:id/cancel", authMiddleware, (req, res) => ctrl.cancelJob(req, res));
runwayRouter.post("/jobs/:id/retry", authMiddleware, (req, res) => ctrl.retryJob(req, res));
runwayRouter.delete("/jobs/:id", authMiddleware, (req, res) => ctrl.deleteJob(req, res));

// Upload — require auth
const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "mp4", "mov", "avi"]);
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "avi"]);

runwayRouter.post("/upload", authMiddleware, (req, res) => {
  try {
    const { data, filename } = req.body;
    if (!data || typeof data !== "string") return res.status(400).json({ error: "Missing data field" });
    const ext = (filename || "upload.png").split(".").pop()?.toLowerCase() || "png";
    if (!ALLOWED_EXTENSIONS.has(ext)) return res.status(400).json({ error: `不支持的文件格式: .${ext}` });
    const buf = Buffer.from(data.replace(/^data:[^;]+;base64,/, ""), "base64");
    const maxSize = VIDEO_EXTENSIONS.has(ext) ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    if (buf.length > maxSize) return res.status(400).json({ error: `文件过大（${Math.round(buf.length/1024/1024)}MB），上限 ${Math.round(maxSize/1024/1024)}MB` });
    if (buf.length < 1024 && !VIDEO_EXTENSIONS.has(ext)) return res.status(400).json({ error: "图片文件过小，请上传有效图片" });
    const safeName = `upload_${Date.now()}.${ext}`;
    const dest = path.join("/root/runway/uploads", safeName);
    fs.writeFileSync(dest, buf);
    res.json({ url: `/img/${safeName}` });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Capture endpoint (internal, no auth needed)
const captureDir = path.join(process.cwd(), "../../captures");
if (!fs.existsSync(captureDir)) fs.mkdirSync(captureDir, { recursive: true });


// AI Prompt Optimization Proxy (avoids CORS issues with external API)
runwayRouter.post("/ai/optimize", authMiddleware, async (req: any, res: any) => {
  const reqStart = Date.now();
  console.log("[ai/optimize] request received, model:", req.body?.model, "stream:", req.body?.stream, "messages:", req.body?.messages?.length);
  // Log image sizes in user content
  const userMsg = req.body?.messages?.find((m: any) => m.role === "user");
  if (userMsg?.content && Array.isArray(userMsg.content)) {
    const imgCount = userMsg.content.filter((c: any) => c.type === "image_url").length;
    const totalLen = JSON.stringify(userMsg.content).length;
    console.log("[ai/optimize] user content: images=" + imgCount + ", totalPayloadChars=" + totalLen);
  }
  try {
    const fetchMod = await import("node-fetch");
    const fetchFn = fetchMod.default;
    const AbortController = globalThis.AbortController;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000); // 90s timeout
    console.log("[ai/optimize] sending to upstream API, bodySize:", JSON.stringify(req.body).length);
    const apiRes = await fetchFn("https://api.iplcz.cn/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer sk-f9187e54389586de83e738defaa509dfbcb3ccb1314c4799833a325282e0864e",
      },
      body: JSON.stringify(req.body),
      signal: controller.signal as any,
    });
    clearTimeout(timeout);
    console.log("[ai/optimize] upstream responded, status:", apiRes.status, "elapsed:", Date.now() - reqStart, "ms");
    res.writeHead(apiRes.status, {
      "Content-Type": apiRes.headers.get("content-type") || "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    if (apiRes.body) {
      // Body-stream timeout: abort if stalls 90s after headers received
      const bodyTimeout = setTimeout(() => {
        console.error("[ai/optimize] body stream timeout");
        try { (apiRes.body as any).destroy?.(); } catch {}
        // Write SSE error event before closing so frontend knows
        if (!res.writableEnded) {
          try { res.write("data: {\"error\":\"stream_timeout\"}\n\n"); } catch {}
          try { res.end(); } catch {}
        }
      }, 90000);
      (apiRes.body as any).on("error", (err: any) => {
        console.error("[ai/optimize] body stream error:", err.message);
        clearTimeout(bodyTimeout);
        if (!res.writableEnded) { try { res.end(); } catch {} }
      });
      console.log("[ai/optimize] piping body stream to client");
      apiRes.body.pipe(res);
      res.on("finish", () => { clearTimeout(bodyTimeout); console.log("[ai/optimize] stream finished, total elapsed:", Date.now() - reqStart, "ms"); });
      res.on("close", () => { clearTimeout(bodyTimeout); console.log("[ai/optimize] connection closed, total elapsed:", Date.now() - reqStart, "ms"); });
    } else {
      const text = await apiRes.text();
      res.end(text);
    }
  } catch (err: any) {
    console.error("[ai/optimize] error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message || "AI proxy error" });
  }
});

// Admin: prioritize a pending job (move to front of queue)
runwayRouter.post("/jobs/:id/prioritize", authMiddleware, async (req: any, res: any) => {
  try {
    if (req.user!.role !== "admin") {
      return res.status(403).json({ error: "仅管理员可操作" });
    }
    const jobId = req.params.id;
    const { priority = 10 } = req.body || {};

    // Only allow prioritizing pending/queued jobs
    const job = await prisma.runwayJob.findUnique({ where: { id: jobId } }) as any;
    if (!job) return res.status(404).json({ error: "任务不存在" });
    if (!["pending", "queued"].includes(job.status)) {
      return res.status(400).json({ error: "只能优先排队等待中的任务" });
    }

    await prisma.$executeRawUnsafe(
      `UPDATE runway_jobs SET priority = $1 WHERE id = $2::uuid`,
      priority, jobId
    );

    console.log(`[admin] Job ${jobId} priority set to ${priority} by ${req.user!.username}`);
    res.json({ ok: true, priority });
  } catch (err: any) {
    console.error("[prioritize] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

runwayRouter.post("/capture", (req, res) => {
  const data = req.body;
  const filename = `capture_${Date.now()}.json`;
  const filepath = path.join(captureDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`[capture] saved ${filename}: ${data.url}`);
  res.json({ ok: true, saved: filename });
});

runwayRouter.get("/capture", (req, res) => {
  try {
    const files = fs.readdirSync(captureDir)
      .filter(f => f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, 50);
    const captures = files.map(f => {
      const content = JSON.parse(fs.readFileSync(path.join(captureDir, f), "utf-8"));
      return { file: f, ...content };
    });
    res.json(captures);
  } catch {
    res.json([]);
  }
});

// Token status — require auth (now uses DB accounts instead of env vars)
runwayRouter.get("/token-status", authMiddleware, async (req, res) => {
  try {
    // Per-user active task count and concurrency limit
    const userId = req.user?.id;
    const ACTIVE_STATUSES = ["pending", "queued", "submitted", "processing"];
    const userActiveCount = userId
      ? await prisma.runwayJob.count({ where: { userId, status: { in: ACTIVE_STATUSES } } }).catch(() => 0)
      : 0;
    const userRecord = userId
      ? await prisma.user.findUnique({ where: { id: userId }, select: { maxConcurrency: true, dailyQuota: true, totalQuota: true } }).catch(() => null)
      : null;
    const userMaxConcurrency = userRecord?.maxConcurrency ?? 2;

    // Daily quota info
    let dailyUsed = 0;
    const dailyQuota = userRecord?.dailyQuota ?? null;
    if (userId && dailyQuota !== null) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      dailyUsed = await prisma.runwayJob.count({ where: { userId, createdAt: { gte: todayStart } } }).catch(() => 0);
    }

    // Total quota info
    let totalUsed = 0;
    const totalQuota = userRecord?.totalQuota ?? null;
    if (userId && totalQuota !== null) {
      totalUsed = await prisma.runwayJob.count({ where: { userId } }).catch(() => 0);
    }

    // Get account info from DB instead of env vars
    const accounts = await prisma.runwayAccount.findMany({
      where: { isActive: true },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });

    const tokens = await Promise.all(accounts.map(async (a, idx) => {
      const cooled = await redisConnection.get(`account:cooldown:${a.id}`).catch(() => null);
      const cooldownTtl = cooled ? await redisConnection.ttl(`account:cooldown:${a.id}`).catch(() => 0) : 0;
      const current = await redisConnection.get(`account:concurrency:${a.id}`).catch(() => null);

      // Decode JWT exp if token is a JWT
      let expiresAt: string | null = null;
      let expiresInDays: number | null = null;
      let expiringSoon = false;
      if (a.tokenExpiresAt) {
        expiresAt = a.tokenExpiresAt.toISOString();
        expiresInDays = Math.round((a.tokenExpiresAt.getTime() - Date.now()) / 86400000);
        expiringSoon = expiresInDays < 7;
      }

      return {
        id: a.id,
        label: a.label,
        tokenShort: a.tokenShort,
        teamId: a.teamId,
        index: idx + 1,
        expiresAt,
        expiresInDays,
        expiringSoon,
        inCooldown: !!cooled,
        cooldownTtl,
        maxConcurrency: a.maxConcurrency,
        currentConcurrency: current ? parseInt(current, 10) : 0,
      };
    }));

    res.json({
      tokens,
      count: tokens.length,
      activeTasks: userActiveCount,
      maxConcurrency: userMaxConcurrency,
      dailyUsed,
      dailyQuota,
      totalUsed,
      totalQuota,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});
