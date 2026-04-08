import { Router } from "express";
import { authMiddleware, adminMiddleware } from "../middleware/auth";
import { prisma } from "../services/prisma";

export const klingRouter = Router();

// POST /api/kling/jobs — create (idempotent on taskId)
klingRouter.post("/jobs", authMiddleware, async (req: any, res: any) => {
  try {
    const { taskId, cat, prompt } = req.body || {};
    if (!taskId || typeof taskId !== "string") {
      return res.status(400).json({ error: "缺少 taskId" });
    }
    const existing = await prisma.klingJob.findUnique({ where: { taskId } });
    if (existing) return res.json({ ok: true, job: existing });
    const job = await prisma.klingJob.create({
      data: {
        taskId,
        userId: req.user.id,
        cat: typeof cat === "string" ? cat : null,
        prompt: typeof prompt === "string" ? prompt : null,
        status: "processing",
      },
    });
    res.json({ ok: true, job });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "服务器错误" });
  }
});

// PATCH /api/kling/jobs/:taskId — owner or admin
klingRouter.patch("/jobs/:taskId", authMiddleware, async (req: any, res: any) => {
  try {
    const { taskId } = req.params;
    const { status, resultUrl } = req.body || {};
    const job = await prisma.klingJob.findUnique({ where: { taskId } });
    if (!job) return res.status(404).json({ error: "任务不存在" });
    if (job.userId !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ error: "无权限" });
    }
    const data: any = {};
    if (typeof status === "string") data.status = status;
    if (typeof resultUrl === "string") data.resultUrl = resultUrl;
    const updated = await prisma.klingJob.update({ where: { taskId }, data });
    res.json({ ok: true, job: updated });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "服务器错误" });
  }
});

// GET /api/kling/jobs — list
klingRouter.get("/jobs", authMiddleware, async (req: any, res: any) => {
  try {
    const isAdmin = req.user.role === "admin";
    const qUserId = typeof req.query.userId === "string" ? req.query.userId : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const cat = typeof req.query.cat === "string" ? req.query.cat : undefined;
    let limit = parseInt(String(req.query.limit || "200"), 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 200;
    if (limit > 500) limit = 500;
    let offset = parseInt(String(req.query.offset || "0"), 10);
    if (!Number.isFinite(offset) || offset < 0) offset = 0;

    const where: any = {};
    if (isAdmin) {
      if (qUserId) where.userId = qUserId;
    } else {
      where.userId = req.user.id;
    }
    if (status) where.status = status;
    if (cat) where.cat = cat;

    const [jobs, total] = await Promise.all([
      prisma.klingJob.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: { user: { select: { id: true, username: true } } },
      }),
      prisma.klingJob.count({ where }),
    ]);
    res.json({ jobs, total });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "服务器错误" });
  }
});

// GET /api/kling/jobs/users — admin only
klingRouter.get("/jobs/users", adminMiddleware, async (_req: any, res: any) => {
  try {
    const grouped = await prisma.klingJob.groupBy({
      by: ["userId"],
      _count: { userId: true },
    });
    if (grouped.length === 0) return res.json({ users: [] });
    const users = await prisma.user.findMany({
      where: { id: { in: grouped.map((g) => g.userId) } },
      select: { id: true, username: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u.username]));
    const result = grouped
      .map((g) => ({
        id: g.userId,
        username: userMap.get(g.userId) || "",
        jobCount: g._count.userId,
      }))
      .sort((a, b) => b.jobCount - a.jobCount);
    res.json({ users: result });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "服务器错误" });
  }
});
