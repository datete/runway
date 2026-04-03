import IORedis from "ioredis";
import { Router } from "express";
import { RunwayController } from "../controllers/runway.controller";
import { authMiddleware } from "../middleware/auth";
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

function parseTokensForStatus(): Array<{ token: string; teamId: number; id: string }> {
  const multi = process.env.RUNWAY_TOKENS;
  if (multi) {
    return multi.split(",").map(pair => {
      const [token, teamIdStr] = pair.trim().split(":");
      return { token, teamId: Number(teamIdStr), id: token.slice(-16) };
    }).filter(t => t.token && t.teamId);
  }
  const t = process.env.RUNWAY_TOKEN;
  const id = Number(process.env.RUNWAY_TEAM_ID);
  if (t && id) return [{ token: t, teamId: id, id: t.slice(-16) }];
  return [];
}

function decodeJwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
    return typeof payload.exp === "number" ? Math.floor(payload.exp) : null;
  } catch { return null; }
}

const _redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null, lazyConnect: true,
});

// Token status — require auth
runwayRouter.get("/token-status", authMiddleware, async (req, res) => {
  try {
    await _redis.connect().catch(() => {});
    const tokens = parseTokensForStatus();
    const now = Math.floor(Date.now() / 1000);
    const { PrismaClient } = await import("@prisma/client");
    const _prisma = new PrismaClient();

    // Per-user active task count and concurrency limit
    const userId = req.user?.id;
    const ACTIVE_STATUSES = ["pending", "queued", "submitted", "processing"];
    const userActiveCount = userId
      ? await _prisma.runwayJob.count({ where: { userId, status: { in: ACTIVE_STATUSES } } }).catch(() => 0)
      : 0;
    const userRecord = userId
      ? await _prisma.user.findUnique({ where: { id: userId }, select: { maxConcurrency: true, dailyQuota: true, totalQuota: true } }).catch(() => null)
      : null;
    const userMaxConcurrency = userRecord?.maxConcurrency ?? 2;

    // Daily quota info
    let dailyUsed = 0;
    const dailyQuota = userRecord?.dailyQuota ?? null;
    if (userId && dailyQuota !== null) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      dailyUsed = await _prisma.runwayJob.count({ where: { userId, createdAt: { gte: todayStart } } }).catch(() => 0);
    }

    const result = await Promise.all(tokens.map(async (t, idx) => {
      const exp = decodeJwtExp(t.token);
      const key = "runway:token:cd:" + t.id;
      const cooled = await _redis.get(key).catch(() => null);
      const cooldownTtl = cooled ? await _redis.ttl(key).catch(() => 0) : 0;
      return {
        id: t.id, teamId: t.teamId, index: idx + 1,
        expiresAt: exp ? new Date(exp * 1000).toISOString() : null,
        expiresInDays: exp ? Math.round((exp - now) / 86400) : null,
        expiringSoon: exp ? (exp - now) < 7 * 86400 : false,
        inCooldown: !!cooled, cooldownTtl,
      };
    }));
    // Total quota info
    let totalUsed = 0;
    const totalQuota = userRecord?.totalQuota ?? null;
    if (userId && totalQuota !== null) {
      totalUsed = await _prisma.runwayJob.count({ where: { userId } }).catch(() => 0);
    }

    await _prisma.$disconnect().catch(() => {});

    res.json({
      tokens: result, count: result.length,
      activeTasks: userActiveCount, maxConcurrency: userMaxConcurrency,
      dailyUsed, dailyQuota,
      totalUsed, totalQuota,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});
