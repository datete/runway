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
runwayRouter.get("/jobs", authMiddleware, (req, res) => ctrl.listJobs(req, res));
runwayRouter.get("/jobs/:id", authMiddleware, (req, res) => ctrl.getJob(req, res));
runwayRouter.post("/jobs/:id/cancel", authMiddleware, (req, res) => ctrl.cancelJob(req, res));
runwayRouter.post("/jobs/:id/retry", authMiddleware, (req, res) => ctrl.retryJob(req, res));
runwayRouter.delete("/jobs/:id", authMiddleware, (req, res) => ctrl.deleteJob(req, res));

// Upload — require auth
runwayRouter.post("/upload", authMiddleware, (req, res) => {
  try {
    const { data, filename } = req.body;
    if (!data || typeof data !== "string") return res.status(400).json({ error: "Missing data field" });
    const ext = (filename || "upload.png").split(".").pop()?.toLowerCase() || "png";
    const safeName = `upload_${Date.now()}.${ext}`;
    const dest = path.join("/root/runway/uploads", safeName);
    const buf = Buffer.from(data.replace(/^data:[^;]+;base64,/, ""), "base64");
    fs.writeFileSync(dest, buf);
    res.json({ url: `/img/${safeName}` });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Capture endpoint (internal, no auth needed)
const captureDir = path.join(process.cwd(), "../../captures");
if (!fs.existsSync(captureDir)) fs.mkdirSync(captureDir, { recursive: true });

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
