import { Router } from "express";
import { RunwayController } from "../controllers/runway.controller";
import { authMiddleware, adminMiddleware } from "../middleware/auth";
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

// Tags (remark-based)
runwayRouter.get("/tags", authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const role = (req as any).user?.role;
    const where: any = role === "admin"
      ? { remark: { not: null }, status: { not: "deleted" } }
      : { userId, remark: { not: null }, status: { not: "deleted" } };
    const tags = await prisma.runwayJob.groupBy({
      by: ["remark"],
      where,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    });
    res.json(tags.filter(t => t.remark).map(t => ({ tag: t.remark, count: t._count.id })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

runwayRouter.delete("/tags/:tag", authMiddleware, async (req, res) => {
  try {
    const tag = decodeURIComponent(req.params.tag);
    const userId = (req as any).user?.id;
    const role = (req as any).user?.role;
    const where: any = role === "admin"
      ? { remark: tag, status: { not: "deleted" } }
      : { userId, remark: tag, status: { not: "deleted" } };
    // First count
    const count = await prisma.runwayJob.count({ where });
    if (count === 0) return res.status(404).json({ error: "no jobs with this tag" });
    // Soft delete all
    const result = await prisma.runwayJob.updateMany({
      where,
      data: { status: "deleted", finishedAt: new Date() },
    });
    res.json({ deleted: result.count, tag });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

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
        "Authorization": `Bearer ${process.env.AI_OPTIMIZE_API_KEY}`,
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

// Capture: admin-only. Auto-sync-token was removed — token rotation must go through admin UI.
runwayRouter.post("/capture", adminMiddleware, async (req, res) => {
  try {
    const data = req.body;
    const filename = `capture_${Date.now()}.json`;
    const filepath = path.join(captureDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    console.log(`[capture] saved ${filename} by ${req.user!.username}`);
    res.json({ ok: true, saved: filename });
  } catch (e: any) {
    res.status(500).json({ error: "capture save failed" });
  }
});

runwayRouter.get("/capture", adminMiddleware, (req, res) => {
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

    // Daily total (includes deleted — deletion does not decrement)
    let dailyUsed = 0;
    let dailyQuotaUsed = 0;
    let systemDailyTotal = 0;
    const dailyQuota = userRecord?.dailyQuota ?? null;
    {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      if (userId) {
        dailyUsed = await prisma.runwayJob.count({ where: { userId, createdAt: { gte: todayStart } } }).catch(() => 0);
        dailyQuotaUsed = await prisma.runwayJob.count({ where: { userId, createdAt: { gte: todayStart }, status: { notIn: ["deleted", "failed", "cancelled"] } } }).catch(() => 0);
      }
      systemDailyTotal = await prisma.runwayJob.count({ where: { status: "completed", finishedAt: { gte: todayStart } } }).catch(() => 0);
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
      dailyQuotaUsed,
      systemDailyTotal,
      dailyQuota,
      totalUsed,
      totalQuota,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});
// ============================================================
// Seedream 5.0 routes — direct API (taskType: seedream_5)
// Appended to runway.ts. Requires: prisma, authMiddleware, fetch (node-fetch already imported dynamically in this file).
// ============================================================

async function _runwayFetch(path: string, init: any, account: any) {
  const fetchMod = await import("node-fetch");
  const fetch: any = (fetchMod as any).default || fetchMod;
  const headers = {
    "Authorization": `Bearer ${account.token}`,
    "Content-Type": "application/json",
    "X-Runway-Workspace": account.teamId,
    ...(init.headers || {}),
  };
  let agent: any;
  if (account.proxyUrl) {
    try {
      if (account.proxyUrl.startsWith("socks")) {
        const { SocksProxyAgent } = await import("socks-proxy-agent");
        agent = new SocksProxyAgent(account.proxyUrl);
      } else {
        const { HttpsProxyAgent } = await import("https-proxy-agent");
        agent = new HttpsProxyAgent(account.proxyUrl);
      }
    } catch {}
  }
  const res = await fetch(`https://api.runwayml.com${path}`, { ...init, headers, ...(agent ? { agent } : {}) });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

async function _pickSeedreamAccount() {
  const accounts = await prisma.runwayAccount.findMany({
    where: { isActive: true },
    orderBy: [{ priority: "desc" }, { lastUsedAt: "asc" }],
  });
  return accounts[0] || null;
}

// POST /api/runway/seedream/upload — upload reference image to Runway CDN (3-step flow)
runwayRouter.post("/seedream/upload", authMiddleware, async (req: any, res: any) => {
  try {
    const { data, filename } = req.body || {};
    if (!data || typeof data !== "string") return res.status(400).json({ error: "缺少 data" });
    const safeName = filename || `upload_${Date.now()}.png`;
    const ext = safeName.split(".").pop()?.toLowerCase() || "png";
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
               : ext === "webp" ? "image/webp"
               : ext === "gif" ? "image/gif"
               : "image/png";
    const buf = Buffer.from(data.replace(/^data:[^;]+;base64,/, ""), "base64");
    if (buf.length < 512) return res.status(400).json({ error: "图片过小" });
    if (buf.length > 10 * 1024 * 1024) return res.status(400).json({ error: "图片过大（>10MB）" });

    const account = await _pickSeedreamAccount();
    if (!account) return res.status(503).json({ error: "无可用账号" });

    // Step 1: request upload URL
    console.log("[seedream:log] POST /v1/uploads filename:", safeName);
    const r1 = await _runwayFetch("/v1/uploads", {
      method: "POST",
      body: JSON.stringify({ filename: safeName, numberOfParts: 1, type: "DATASET" }),
    }, account);
    console.log("[seedream:log] /v1/uploads status:", r1.status, "body:", r1.text.slice(0,400));
    if (!r1.ok) return res.status(502).json({ error: `上传失败 ${r1.status}`, detail: r1.text.slice(0, 500) });
    const uploadId = r1.json?.id;
    const uploadUrl = r1.json?.uploadUrls?.[0];
    const uploadHeaders = r1.json?.uploadHeaders || { "Content-Type": mime };
    if (!uploadId || !uploadUrl) return res.status(502).json({ error: "未返回 uploadUrls" });

    // Step 2: PUT bytes to presigned S3
    const fetchMod = await import("node-fetch");
    const fetch: any = (fetchMod as any).default || fetchMod;
    let agent: any;
    if (account.proxyUrl) {
      try {
        if (account.proxyUrl.startsWith("socks")) {
          const { SocksProxyAgent } = await import("socks-proxy-agent");
          agent = new SocksProxyAgent(account.proxyUrl);
        } else {
          const { HttpsProxyAgent } = await import("https-proxy-agent");
          agent = new HttpsProxyAgent(account.proxyUrl);
        }
      } catch {}
    }
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: uploadHeaders,
      body: buf,
      ...(agent ? { agent } : {}),
    });
    if (!putRes.ok) {
      const t = await putRes.text().catch(() => "");
      return res.status(502).json({ error: `S3 PUT ${putRes.status}`, detail: t.slice(0, 300) });
    }
    const etag = (putRes.headers.get("etag") || putRes.headers.get("ETag") || "").replace(/^"|"$/g, "");
    if (!etag) return res.status(502).json({ error: "S3 未返回 ETag" });

    // Step 3: complete upload
    const r3 = await _runwayFetch(`/v1/uploads/${uploadId}/complete`, {
      method: "POST",
      body: JSON.stringify({ parts: [{ PartNumber: 1, ETag: etag }] }),
    }, account);
    if (!r3.ok) return res.status(502).json({ error: `complete 失败 ${r3.status}`, detail: r3.text.slice(0, 500) });
    const cdnUrl = r3.json?.url;
    if (!cdnUrl) return res.status(502).json({ error: "未返回 CDN url" });

    res.json({ ok: true, assetId: uploadId, url: cdnUrl, filename: safeName });
  } catch (e: any) {
    console.error("[seedream:upload]", e);
    res.status(500).json({ error: e.message || "上传失败" });
  }
});

// POST /api/runway/seedream — create Seedream 5.0 task
runwayRouter.post("/seedream", authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "未登录" });
    const { prompt, aspectRatio, resolution, numImages, exploreMode, referenceImages, name } = req.body || {};
    if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: "提示词不能为空" });
    const ar = aspectRatio || "1:1";
    const rs = resolution || "2k";
    const n = Math.max(1, Math.min(4, Number(numImages) || 1));

    const account = await _pickSeedreamAccount();
    if (!account) return res.status(503).json({ error: "无可用账号" });

    const { randomUUID } = await import("crypto");
    const options: any = {
      name: name || `Seedream 50 - ${String(prompt).slice(0, 20)}`,
      prompt: String(prompt),
      aspectRatio: ar,
      resolution: rs,
      numImages: n,
      exploreMode: exploreMode === true,
      creationSource: "tool-mode",
    };
    if (Array.isArray(referenceImages) && referenceImages.length > 0) {
      options.referenceImages = referenceImages
        .filter((r: any) => r && r.assetId && r.url)
        .map((r: any, i: number) => ({
          tag: r.tag || `IMG_${i + 1}`,
          url: r.url,
          assetId: r.assetId,
        }));
    }

    const body = { taskType: "seedream_5", asTeamId: Number(account.teamId), options };
    console.log("[seedream:log] POST /v1/tasks body:", JSON.stringify(body).slice(0,800));
    const r = await _runwayFetch("/v1/tasks", { method: "POST", body: JSON.stringify(body) }, account);
    console.log("[seedream:log] /v1/tasks status:", r.status, "body:", r.text.slice(0,500));
    if (!r.ok) {
      await prisma.runwayAccount.update({
        where: { id: account.id },
        data: { lastErrorAt: new Date(), lastErrorMessage: `seedream create ${r.status}: ${r.text.slice(0, 300)}` },
      }).catch(() => {});
      return res.status(502).json({ error: `API ${r.status}`, detail: r.text.slice(0, 500) });
    }
    const remoteTaskId = r.json?.id || r.json?.task?.id || r.json?.taskId;
    if (!remoteTaskId) return res.status(502).json({ error: "未返回 taskId", raw: r.json });

    const row = await prisma.seedreamJob.create({
      data: {
        userId,
        accountId: account.id,
        remoteTaskId,
        status: "pending",
        prompt: String(prompt),
        aspectRatio: ar,
        resolution: rs,
        numImages: n,
        exploreMode: options.exploreMode,
        referenceImages: options.referenceImages || null,
      },
    });
    await prisma.runwayAccount.update({ where: { id: account.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    res.json({ ok: true, job: row });
  } catch (e: any) {
    console.error("[seedream:create][seedream:log]", e);
    res.status(500).json({ error: e.message || "创建失败" });
  }
});

// GET /api/runway/seedream — list current user's Seedream jobs
runwayRouter.get("/seedream", authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === "admin";
    const limit = Math.min(200, Number(req.query.limit) || 100);
    const rows = await prisma.seedreamJob.findMany({
      where: isAdmin ? {} : { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    res.json({ ok: true, jobs: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/runway/seedream/:id — refresh status from Runway if not terminal
runwayRouter.get("/seedream/:id", authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === "admin";
    const row = await prisma.seedreamJob.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: "未找到" });
    if (!isAdmin && row.userId !== userId) return res.status(403).json({ error: "无权限" });

    if (row.status !== "SUCCEEDED" && row.status !== "FAILED" && row.remoteTaskId && row.accountId) {
      const account = await prisma.runwayAccount.findUnique({ where: { id: row.accountId } });
      if (account) {
        const r = await _runwayFetch(`/v1/tasks/${row.remoteTaskId}?asTeamId=${account.teamId}`, { method: "GET" }, account);
        if (r.ok && r.json) {
          const t = r.json.task || r.json;
          const status = (t.status || "").toUpperCase();
          let images: any = null;
          let err: string | null = null;
          if (status === "SUCCEEDED") {
            const artifacts = t.artifacts || t.output || [];
            images = artifacts.map((a: any, i: number) => ({ index: i, url: a.url || a.imageUrl || a }));
          } else if (status === "FAILED") {
            err = t.errorMessage || t.error || "任务失败";
          }
          const updated = await prisma.seedreamJob.update({
            where: { id: row.id },
            data: {
              status: status || row.status,
              images: images || (row.images as any),
              errorMessage: err || row.errorMessage,
            },
          });
          // review.engine hook — fire-and-forget
          try {
            if (status === "SUCCEEDED" && images && images[0]?.url) {
              const eng = await import("../services/review.engine");
              eng.onSeedreamCompleted(row.id, images[0].url).catch((e:any)=>console.error("[review hook]",e?.message));
            } else if (status === "FAILED") {
              const eng = await import("../services/review.engine");
              eng.onSeedreamFailed?.(row.id).catch?.(()=>{});
            }
          } catch (e:any) { console.error("[review hook] import error", e?.message); }
          return res.json({ ok: true, job: updated });
        }
      }
    }
    res.json({ ok: true, job: row });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/runway/seedream/:id
runwayRouter.delete("/seedream/:id", authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === "admin";
    const row = await prisma.seedreamJob.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: "未找到" });
    if (!isAdmin && row.userId !== userId) return res.status(403).json({ error: "无权限" });
    await prisma.seedreamJob.delete({ where: { id: row.id } });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// Runway Video routes — direct API (taskType: gen4 / gen4_turbo)
// ============================================================

async function _pickVideoAccount() {
  const accounts = await prisma.runwayAccount.findMany({
    where: { isActive: true },
    orderBy: [{ priority: "desc" }, { lastUsedAt: "asc" }],
  });
  return accounts[0] || null;
}

async function _uploadAssetToRunway(account: any, dataUrl: string, filename: string) {
  const safeName = filename || `upload_${Date.now()}.png`;
  const ext = safeName.split(".").pop()?.toLowerCase() || "png";
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
             : ext === "webp" ? "image/webp"
             : ext === "gif" ? "image/gif"
             : "image/png";
  const buf = Buffer.from(String(dataUrl).replace(/^data:[^;]+;base64,/, ""), "base64");
  if (buf.length < 512) throw new Error("image too small");
  if (buf.length > 10 * 1024 * 1024) throw new Error("image too large");

  const r1 = await _runwayFetch("/v1/uploads", {
    method: "POST",
    body: JSON.stringify({ filename: safeName, numberOfParts: 1, type: "DATASET" }),
  }, account);
  if (!r1.ok) throw new Error(`上传失败 ${r1.status}: ${r1.text.slice(0,300)}`);
  const uploadId = r1.json?.id;
  const uploadUrl = r1.json?.uploadUrls?.[0];
  const uploadHeaders = r1.json?.uploadHeaders || { "Content-Type": mime };
  if (!uploadId || !uploadUrl) throw new Error("no uploadUrls");

  const fetchMod = await import("node-fetch");
  const fetch: any = (fetchMod as any).default || fetchMod;
  let agent: any;
  if (account.proxyUrl) {
    try {
      if (account.proxyUrl.startsWith("socks")) {
        const { SocksProxyAgent } = await import("socks-proxy-agent");
        agent = new SocksProxyAgent(account.proxyUrl);
      } else {
        const { HttpsProxyAgent } = await import("https-proxy-agent");
        agent = new HttpsProxyAgent(account.proxyUrl);
      }
    } catch {}
  }
  const putRes = await fetch(uploadUrl, { method: "PUT", headers: uploadHeaders, body: buf, ...(agent ? { agent } : {}) });
  if (!putRes.ok) {
    const t = await putRes.text().catch(() => "");
    throw new Error(`S3 PUT ${putRes.status}: ${t.slice(0,200)}`);
  }
  const etag = (putRes.headers.get("etag") || putRes.headers.get("ETag") || "").replace(/^"|"$/g, "");
  if (!etag) throw new Error("S3 no ETag");

  const r3 = await _runwayFetch(`/v1/uploads/${uploadId}/complete`, {
    method: "POST",
    body: JSON.stringify({ parts: [{ PartNumber: 1, ETag: etag }] }),
  }, account);
  if (!r3.ok) throw new Error(`complete 失败 ${r3.status}: ${r3.text.slice(0,300)}`);
  const cdnUrl = r3.json?.url;
  if (!cdnUrl) throw new Error("no CDN url");
  return { assetId: uploadId, url: cdnUrl, filename: safeName };
}

runwayRouter.post("/video/upload", authMiddleware, async (req: any, res: any) => {
  try {
    const { data, filename } = req.body || {};
    if (!data || typeof data !== "string") return res.status(400).json({ error: "missing data" });
    const account = await _pickVideoAccount();
    if (!account) return res.status(503).json({ error: "no available account" });
    const out = await _uploadAssetToRunway(account, data, filename);
    res.json({ ok: true, ...out });
  } catch (e: any) {
    console.error("[video:upload]", e);
    res.status(500).json({ error: e.message || "upload failed" });
  }
});

function _ratioToWH(ratio: string): { width: number; height: number } {
  if (ratio === "9:16") return { width: 720, height: 1280 };
  if (ratio === "1:1") return { width: 960, height: 960 };
  return { width: 1280, height: 720 };
}

runwayRouter.post("/video", authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    const {
      prompt,
      mode,
      model: modelIn,
      ratio: ratioIn,
      seconds: secondsIn,
      referenceImage,
      seed: seedIn,
      watermark,
      exploreMode,
      name,
    } = req.body || {};
    if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: "prompt required" });
    if (mode !== "text_to_video" && mode !== "image_to_video") return res.status(400).json({ error: "mode must be text_to_video or image_to_video" });
    const model = modelIn === "gen4" ? "gen4" : "gen4_turbo";
    const ratio = ratioIn === "9:16" || ratioIn === "1:1" ? ratioIn : "16:9";
    const seconds = Number(secondsIn) === 10 ? 10 : 5;
    if (mode === "image_to_video") {
      if (!referenceImage || !referenceImage.assetId || !referenceImage.url) {
        return res.status(400).json({ error: "image_to_video requires referenceImage assetId/url" });
      }
    }
    const { width, height } = _ratioToWH(ratio);

    const account = await _pickVideoAccount();
    if (!account) return res.status(503).json({ error: "no available account" });

    const { randomUUID, randomInt } = await import("crypto");
    const seed = Number.isFinite(Number(seedIn)) ? Number(seedIn) : randomInt(1, 4294967295);

    const options: any = {
      name: name || `${model === "gen4_turbo" ? "Gen-4 Turbo" : "Gen-4"} - ${String(prompt).slice(0, 40)}`,
      text_prompt: String(prompt),
      seconds,
      width,
      height,
      seed,
      watermark: !!watermark,
      exploreMode: exploreMode === true,
      assetGroupId: randomUUID(),
      creationSource: "tool-mode",
      route: mode === "image_to_video" ? "i2v" : "t2v",
    };
    if (mode === "image_to_video") {
      options.init_image = referenceImage.url;
      options.imageAssetId = referenceImage.assetId;
    }

    const body = {
      taskType: model,
      asTeamId: Number(account.teamId),
      sessionId: randomUUID(),
      options,
    };
    console.log("[video:log] POST /v1/tasks body:", JSON.stringify(body).slice(0, 800));
    const r = await _runwayFetch("/v1/tasks", { method: "POST", body: JSON.stringify(body) }, account);
    console.log("[video:log] /v1/tasks status:", r.status, "body:", r.text.slice(0, 500));
    if (!r.ok) {
      await prisma.runwayAccount.update({
        where: { id: account.id },
        data: { lastErrorAt: new Date(), lastErrorMessage: `video create ${r.status}: ${r.text.slice(0, 300)}` },
      }).catch(() => {});
      return res.status(502).json({ error: `API ${r.status}`, detail: r.text.slice(0, 500) });
    }
    const remoteTaskId = r.json?.id || r.json?.task?.id || r.json?.taskId;
    if (!remoteTaskId) return res.status(502).json({ error: "no taskId", raw: r.json });

    const row = await (prisma as any).runwayVideoJob.create({
      data: {
        userId,
        accountId: account.id,
        remoteTaskId,
        status: "pending",
        prompt: String(prompt),
        mode,
        model,
        ratio,
        seconds,
        seed,
        watermark: !!watermark,
        exploreMode: options.exploreMode,
        referenceImage: mode === "image_to_video" ? { assetId: referenceImage.assetId, url: referenceImage.url } : null,
      },
    });
    await prisma.runwayAccount.update({ where: { id: account.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    res.json({ ok: true, job: row });
  } catch (e: any) {
    console.error("[video:create]", e);
    res.status(500).json({ error: e.message || "create failed" });
  }
});

runwayRouter.get("/video", authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === "admin";
    const limit = Math.min(200, Number(req.query.limit) || 100);
    const rows = await (prisma as any).runwayVideoJob.findMany({
      where: isAdmin ? {} : { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    res.json({ ok: true, jobs: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

runwayRouter.get("/video/:id", authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === "admin";
    const row = await (prisma as any).runwayVideoJob.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: "not found" });
    if (!isAdmin && row.userId !== userId) return res.status(403).json({ error: "forbidden" });

    const terminal = ["SUCCEEDED", "FAILED", "CANCELED"];
    if (!terminal.includes(row.status) && row.remoteTaskId && row.accountId) {
      const account = await prisma.runwayAccount.findUnique({ where: { id: row.accountId } });
      if (account) {
        const r = await _runwayFetch(`/v1/tasks/${row.remoteTaskId}?asTeamId=${account.teamId}`, { method: "GET" }, account);
        if (r.ok && r.json) {
          const t = r.json.task || r.json;
          const upStatus = (t.status || "").toUpperCase();
          let mapped = row.status;
          if (upStatus === "THROTTLED" || upStatus === "PENDING") mapped = "pending";
          else if (upStatus === "RUNNING") mapped = "RUNNING";
          else if (upStatus === "SUCCEEDED") mapped = "SUCCEEDED";
          else if (upStatus === "FAILED") mapped = "FAILED";
          else if (upStatus === "CANCELED") mapped = "CANCELED";
          let videoUrl: string | null = row.videoUrl;
          let err: string | null = row.errorMessage;
          if (mapped === "SUCCEEDED") {
            const artifacts = t.artifacts || t.output || [];
            const first = Array.isArray(artifacts) ? artifacts[0] : null;
            videoUrl = (first && (first.url || first)) || null;
          } else if (mapped === "FAILED") {
            err = t.errorMessage || t.error || "task failed";
          }
          const updated = await (prisma as any).runwayVideoJob.update({
            where: { id: row.id },
            data: { status: mapped, videoUrl, errorMessage: err },
          });
          return res.json({ ok: true, job: updated });
        }
      }
    }
    res.json({ ok: true, job: row });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
