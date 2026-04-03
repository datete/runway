import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { adminMiddleware } from "../middleware/auth";

const router = Router();
const prisma = new PrismaClient();

router.use(adminMiddleware);

// GET /api/runway/admin/users
router.get("/users", async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, role: true, isActive: true, maxConcurrency: true, dailyQuota: true, totalQuota: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(users);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/runway/admin/users
router.post("/users", async (req: Request, res: Response) => {
  const { username, password, role = "user", isActive = true, maxConcurrency, dailyQuota, totalQuota } = req.body;
  if (!username || !password) return res.status(400).json({ error: "username 和 password 必填" });
  try {
    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { username, passwordHash: hash, role, isActive, maxConcurrency: maxConcurrency ?? null, dailyQuota: dailyQuota ?? null, totalQuota: totalQuota ?? null },
      select: { id: true, username: true, role: true, isActive: true, maxConcurrency: true, dailyQuota: true, totalQuota: true, createdAt: true },
    });
    res.status(201).json(user);
  } catch (e: any) {
    if (e.code === "P2002") return res.status(409).json({ error: "用户名已存在" });
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/runway/admin/users/:id
router.put("/users/:id", async (req: Request, res: Response) => {
  const { password, role, isActive, maxConcurrency, dailyQuota, totalQuota } = req.body;
  try {
    const data: any = {};
    if (password) data.passwordHash = await bcrypt.hash(password, 10);
    if (role !== undefined) data.role = role;
    if (isActive !== undefined) data.isActive = isActive;
    if (maxConcurrency !== undefined) data.maxConcurrency = maxConcurrency === null || maxConcurrency === "" ? null : Number(maxConcurrency);
    if (dailyQuota !== undefined) data.dailyQuota = dailyQuota === null || dailyQuota === "" ? null : Number(dailyQuota);
    if (totalQuota !== undefined) data.totalQuota = totalQuota === null || totalQuota === "" ? null : Number(totalQuota);
    if (Object.keys(data).length === 0) return res.status(400).json({ error: "无修改内容" });
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, username: true, role: true, isActive: true, maxConcurrency: true, dailyQuota: true, totalQuota: true, updatedAt: true },
    });
    res.json(user);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/runway/admin/users/:id
router.delete("/users/:id", async (req: Request, res: Response) => {
  try {
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/runway/admin/jobs
router.get("/jobs", async (req: Request, res: Response) => {
  try {
    const { userId, status, page = "1", limit = "20" } = req.query as any;
    const where: any = {};
    if (userId) where.userId = userId;
    if (status) where.status = status;
    const skip = (Number(page) - 1) * Number(limit);
    const [jobs, total] = await Promise.all([
      prisma.runwayJob.findMany({
        where, orderBy: { createdAt: "desc" },
        skip, take: Number(limit),
        include: { user: { select: { id: true, username: true } } },
      }),
      prisma.runwayJob.count({ where }),
    ]);
    res.json({ jobs, total, page: Number(page), limit: Number(limit) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/runway/admin/logs
router.get("/logs", async (req: Request, res: Response) => {
  try {
    const { userId, action, page = "1", limit = "50" } = req.query as any;
    const where: any = {};
    if (userId) where.userId = userId;
    if (action) where.action = action;
    const skip = (Number(page) - 1) * Number(limit);
    const [logs, total] = await Promise.all([
      prisma.userLog.findMany({
        where, orderBy: { createdAt: "desc" },
        skip, take: Number(limit),
        include: { user: { select: { id: true, username: true } } },
      }),
      prisma.userLog.count({ where }),
    ]);
    res.json({ logs, total, page: Number(page), limit: Number(limit) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});


// GET /api/runway/admin/dashboard
router.get("/dashboard", async (_req: Request, res: Response) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [totalUsers, activeUsers, totalJobs, todayJobs, queuedJobs, processingJobs, completedJobs, failedJobs, recentJobs] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.runwayJob.count(),
      prisma.runwayJob.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.runwayJob.count({ where: { status: { in: ["pending", "queued"] } } }),
      prisma.runwayJob.count({ where: { status: { in: ["submitted", "processing"] } } }),
      prisma.runwayJob.count({ where: { status: "completed" } }),
      prisma.runwayJob.count({ where: { status: "failed" } }),
      prisma.runwayJob.findMany({
        where: { createdAt: { gte: todayStart } },
        select: { userId: true, status: true },
      }),
    ]);

    // Per-user today stats
    const userTodayMap: Record<string, { total: number; completed: number; failed: number }> = {};
    for (const j of recentJobs) {
      const uid = j.userId || "__none__";
      if (!userTodayMap[uid]) userTodayMap[uid] = { total: 0, completed: 0, failed: 0 };
      userTodayMap[uid].total++;
      if (j.status === "completed") userTodayMap[uid].completed++;
      if (j.status === "failed") userTodayMap[uid].failed++;
    }

    // Per-user total job counts
    const userJobCounts = await prisma.runwayJob.groupBy({
      by: ["userId"],
      _count: { id: true },
    });

    // Get user info for mapping
    const allUsers = await prisma.user.findMany({
      select: { id: true, username: true, role: true, isActive: true, maxConcurrency: true, dailyQuota: true, totalQuota: true },
    });

    const userStats = allUsers.map(u => {
      const totalCount = userJobCounts.find(c => c.userId === u.id)?._count?.id || 0;
      const todayInfo = userTodayMap[u.id] || { total: 0, completed: 0, failed: 0 };
      return {
        id: u.id,
        username: u.username,
        role: u.role,
        isActive: u.isActive,
        maxConcurrency: u.maxConcurrency,
        dailyQuota: u.dailyQuota,
        totalQuota: u.totalQuota,
        totalJobs: totalCount,
        todayJobs: todayInfo.total,
        todayCompleted: todayInfo.completed,
        todayFailed: todayInfo.failed,
      };
    });

    res.json({
      overview: { totalUsers, activeUsers, totalJobs, todayJobs, queuedJobs, processingJobs, completedJobs, failedJobs },
      userStats,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export { router as adminRouter };
