import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import IORedis from "ioredis";
import { prisma } from "../services/prisma";
import { DeviceService } from "../services/device.service";
import { adminMiddleware } from "../middleware/auth";

const router = Router();
const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

// CORS preflight for token-submit (browser extension needs this)
router.options("/accounts/token-submit", (_req: Request, res: Response) => {
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.sendStatus(204);
});

// POST /api/runway/admin/accounts/token-submit — No auth, called from browser extension
router.post("/accounts/token-submit", async (req: Request, res: Response) => {
  res.set("Access-Control-Allow-Origin", "*");
  // Shared secret check
  const submitSecret = process.env.TOKEN_SUBMIT_SECRET || '';
  const clientSecret = req.headers['x-submit-secret'] || req.body.secret;
  if (!submitSecret || clientSecret !== submitSecret) {
    return res.status(403).json({ error: '无权限' });
  }
  // This endpoint is called from the browser extension, bypass JWT auth
  // but still validate the request
  const { token, label, proxyUrl, maxConcurrency = 2, priority = 0 } = req.body;
  if (!token) return res.status(400).json({ error: "token 必填" });

  try {
    const fetchMod = await import("node-fetch");
    const fetchFn = fetchMod.default;

    // Build proxy agent
    let agent: any;
    if (proxyUrl) {
      try {
        if (proxyUrl.startsWith('socks')) {
          const mod = require('socks-proxy-agent');
          agent = new mod.SocksProxyAgent(proxyUrl);
        } else {
          const mod = require('https-proxy-agent');
          agent = new mod.HttpsProxyAgent(proxyUrl);
        }
      } catch (e: any) { console.warn('[admin] proxy agent error:', e.message); }
    }

    // Get profile to find teamId
    const profileRes = await fetchFn("https://api.runwayml.com/v1/profile", {
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
      ...(agent ? { agent } : {}),
    });
    if (!profileRes.ok) {
      return res.status(400).json({ error: `Token 无效或已过期 (${profileRes.status})` });
    }
    const profileData = await profileRes.json() as any;
    const user = profileData.user || {};
    const teamId = String(user.id || "");
    const username = user.username || user.email || "unknown";
    const email = user.email || "";

    if (!teamId) return res.status(500).json({ error: "无法获取 TeamID" });

    // Check if account with this teamId already exists
    const existing = await prisma.runwayAccount.findFirst({
      where: { teamId },
    });

    const accountLabel = label || username || email.split("@")[0];
    const tokenShort = token.slice(-12);

    if (existing) {
      // Update existing account with new token
      await prisma.runwayAccount.update({
        where: { id: existing.id },
        data: { token, tokenShort, proxyUrl: proxyUrl || existing.proxyUrl, isActive: true },
      });
      res.json({ ok: true, action: "updated", id: existing.id, label: existing.label, teamId, username });
    } else {
      // Create new account
      const account = await prisma.runwayAccount.create({
        data: { label: accountLabel, token, tokenShort, teamId, proxyUrl: proxyUrl || null, maxConcurrency: Number(maxConcurrency), priority: Number(priority) },
      });
      res.json({ ok: true, action: "created", id: account.id, label: accountLabel, teamId, username });
    }
  } catch (e: any) {
    res.status(500).json({ error: `处理失败: ${e.message}` });
  }
});

// All routes below require admin auth
router.use(adminMiddleware);

// ============== ACCOUNT MANAGEMENT ==============

// GET /api/runway/admin/accounts — List all accounts with live concurrency
router.get("/accounts", async (_req: Request, res: Response) => {
  try {
    const accounts = await prisma.runwayAccount.findMany({
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
    // Hourly completed count per account (last 60 min)
    const hourAgo = new Date(Date.now() - 3600_000);
    const hourlyRows = await prisma.runwayJob.groupBy({
      by: ["accountId"],
      where: { status: "completed", finishedAt: { gte: hourAgo }, accountId: { not: null } },
      _count: { _all: true },
    });
    const hourlyMap: Record<string, number> = {};
    for (const r of hourlyRows) if (r.accountId) hourlyMap[r.accountId] = r._count._all;
    // Get recent jobs per account (max 5 per account, newest first)
    const acctJobs = await prisma.runwayJob.findMany({
      where: { accountId: { not: null }, status: { not: "deleted" } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, accountId: true, userId: true, status: true, progress: true, prompt: true, createdAt: true, updatedAt: true, user: { select: { username: true } } },
    });
    const accountTasksMap: Record<string, Array<{ jobId: string; username: string; status: string; progress: number; prompt: string; createdAt: string }>> = {};
    for (const j of acctJobs) {
      if (!j.accountId) continue;
      if (!accountTasksMap[j.accountId]) accountTasksMap[j.accountId] = [];
      if (accountTasksMap[j.accountId].length >= 5) continue;
      accountTasksMap[j.accountId].push({
        jobId: j.id.slice(0, 8),
        username: j.user?.username || "unknown",
        status: j.status,
        progress: j.progress || 0,
        prompt: (j.prompt || "").slice(0, 30),
        createdAt: j.createdAt.toISOString(),
      });
    }
    // Enrich with live concurrency from Redis
    const enriched = await Promise.all(accounts.map(async a => {
      const current = await redis.get(`account:concurrency:${a.id}`);
      const cooled = await redis.get(`account:cooldown:${a.id}`);
      const batchResting = await redis.get(`submit:batch-resting:${a.id}`);
      const batchRestTtl = batchResting ? await redis.ttl(`submit:batch-resting:${a.id}`) : 0;
      const batchCount = await redis.get(`submit:batch-count:${a.id}`);
      const batchLimit = await redis.get(`submit:batch-limit:${a.id}`);
      const tasks = accountTasksMap[a.id] || [];
      return {
        id: a.id,
        label: a.label,
        tokenShort: a.tokenShort,
        teamId: a.teamId,
        proxyUrl: a.proxyUrl,
        maxConcurrency: a.maxConcurrency,
        currentConcurrency: current ? parseInt(current, 10) : 0,
        isActive: a.isActive,
        priority: a.priority,
        inCooldown: Boolean(cooled),
        batchResting: Boolean(batchResting),
        batchRestTtl,
        batchCount: batchCount ? parseInt(batchCount, 10) : 0,
        batchLimit: batchLimit ? parseInt(batchLimit, 10) : 0,
        totalGenerated: a.totalGenerated,
        hourlyGenerated: hourlyMap[a.id] || 0,
        lastUsedAt: a.lastUsedAt,
        lastErrorAt: a.lastErrorAt,
        lastErrorMessage: a.lastErrorMessage,
        tokenExpiresAt: a.tokenExpiresAt,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        activeTasks: tasks,
      };
    }));
    res.json(enriched);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/runway/admin/accounts — Add a new account
router.post("/accounts", async (req: Request, res: Response) => {
  const { label, token, teamId, proxyUrl, maxConcurrency = 2, priority = 0 } = req.body;
  if (!label || !token || !teamId) return res.status(400).json({ error: "label, token, teamId 必填" });
  try {
    const tokenShort = token.slice(-12);
    const account = await prisma.runwayAccount.create({
      data: { label, token, tokenShort, teamId: String(teamId), proxyUrl: proxyUrl || null, maxConcurrency, priority },
    });
    res.status(201).json({ id: account.id, label: account.label, tokenShort: account.tokenShort, teamId: account.teamId });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PUT /api/runway/admin/accounts/:id — Update an account
router.put("/accounts/:id", async (req: Request, res: Response) => {
  const { label, token, teamId, proxyUrl, maxConcurrency, priority, isActive, tokenExpiresAt } = req.body;
  try {
    const data: any = {};
    if (label !== undefined) data.label = label;
    if (token !== undefined) { data.token = token; data.tokenShort = token.slice(-12); }
    if (teamId !== undefined) data.teamId = String(teamId);
    if (proxyUrl !== undefined) data.proxyUrl = proxyUrl || null;
    if (maxConcurrency !== undefined) data.maxConcurrency = Number(maxConcurrency);
    if (priority !== undefined) data.priority = Number(priority);
    if (isActive !== undefined) data.isActive = Boolean(isActive);
    if (tokenExpiresAt !== undefined) data.tokenExpiresAt = tokenExpiresAt ? new Date(tokenExpiresAt) : null;
    if (Object.keys(data).length === 0) return res.status(400).json({ error: "无修改内容" });
    const account = await prisma.runwayAccount.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ id: account.id, label: account.label, tokenShort: account.tokenShort, isActive: account.isActive });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/runway/admin/accounts/:id — Soft delete (deactivate)
router.delete("/accounts/:id", async (req: Request, res: Response) => {
  try {
    await prisma.runwayAccount.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    // Clear concurrency counter
    await redis.del(`account:concurrency:${req.params.id}`);
    await redis.del(`account:cooldown:${req.params.id}`);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/runway/admin/accounts/:id/reset-cooldown - Reset account cooldown
router.post("/accounts/:id/reset-cooldown", async (req: Request, res: Response) => {
  try {
    const accountId = req.params.id;
    const account = await prisma.runwayAccount.findUnique({ where: { id: accountId } });
    if (!account) return res.status(404).json({ error: "账号不存在" });
    await redis.del(`account:cooldown:${accountId}`);
    await prisma.runwayAccount.update({
      where: { id: accountId },
      data: { lastErrorAt: null, lastErrorMessage: null },
    });
    console.log(`[admin] reset cooldown for ${account.label} by ${(req as any).user?.username}`);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/runway/admin/accounts/:id/reset-batch — Reset batch rest
router.post("/accounts/:id/reset-batch", async (req: Request, res: Response) => {
  try {
    const accountId = req.params.id;
    const account = await prisma.runwayAccount.findUnique({ where: { id: accountId } });
    if (!account) return res.status(404).json({ error: "账号不存在" });
    await redis.del(`submit:batch-resting:${accountId}`);
    await redis.del(`submit:batch-count:${accountId}`);
    await redis.del(`submit:batch-limit:${accountId}`);
    console.log(`[admin] reset batch for ${account.label} by ${(req as any).user?.username}`);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/runway/admin/accounts/:id/test — Test account connectivity
router.get("/accounts/:id/test", async (req: Request, res: Response) => {
  try {
    const account = await prisma.runwayAccount.findUnique({ where: { id: req.params.id } });
    if (!account) return res.status(404).json({ error: "账号不存在" });

    // Try a simple API call to verify the token works
    const fetchMod = await import("node-fetch");
    const fetchFn = fetchMod.default;
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${account.token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Runway-Workspace": account.teamId,
    };

    let agent: any;
    if (account.proxyUrl) {
      try {
        if (account.proxyUrl.startsWith('socks')) {
          const mod = require('socks-proxy-agent');
          agent = new mod.SocksProxyAgent(account.proxyUrl);
        } else {
          const mod = require('https-proxy-agent');
          agent = new mod.HttpsProxyAgent(account.proxyUrl);
        }
      } catch (e: any) { console.warn('[admin] proxy agent error:', e.message); }
    }

    const testRes = await fetchFn(`https://api.runwayml.com/v1/tasks?asTeamId=${account.teamId}&limit=1`, {
      headers,
      ...(agent ? { agent } : {}),
    });

    if (testRes.ok) {
      const data = await testRes.json() as any;
      const activeTasks = (data.tasks || []).filter(
        (t: any) => t.status === 'RUNNING' || t.status === 'THROTTLED' || t.status === 'PENDING'
      ).length;
      res.json({ ok: true, activeTasks, message: `连接成功，当前活跃任务: ${activeTasks}` });
    } else {
      const text = await testRes.text();
      res.json({ ok: false, status: testRes.status, message: `API 返回 ${testRes.status}: ${text.slice(0, 200)}` });
    }
  } catch (e: any) {
    res.json({ ok: false, message: `连接失败: ${e.message}` });
  }
});

// ============== USER MANAGEMENT ==============

// POST /api/runway/admin/accounts/login — Login to Runway with email/password, get token + teamId
router.post("/accounts/login", async (req: Request, res: Response) => {
  const { email, password, proxyUrl } = req.body;
  if (!email || !password) return res.status(400).json({ error: "邮箱和密码必填" });
  try {
    const fetchMod = await import("node-fetch");
    const fetchFn = fetchMod.default;

    // Build proxy agent if provided
    let agent: any;
    if (proxyUrl) {
      try {
        if (proxyUrl.startsWith('socks')) {
          const mod = require('socks-proxy-agent');
          agent = new mod.SocksProxyAgent(proxyUrl);
        } else {
          const mod = require('https-proxy-agent');
          agent = new mod.HttpsProxyAgent(proxyUrl);
        }
      } catch (e: any) { console.warn('[admin] proxy agent error:', e.message); }
    }

    // Step 1: Login to Runway
    const loginRes = await fetchFn("https://api.runwayml.com/v1/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ email, password }),
      ...(agent ? { agent } : {}),
    });
    if (!loginRes.ok) {
      const err = await loginRes.json() as any;
      return res.status(loginRes.status).json({ error: err.error || `登录失败 (${loginRes.status})` });
    }
    const loginData = await loginRes.json() as any;
    const token = loginData.token;
    if (!token) return res.status(500).json({ error: "登录成功但未返回token" });

    // Step 2: Get profile to find teamId
    const profileRes = await fetchFn("https://api.runwayml.com/v1/profile", {
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
      ...(agent ? { agent } : {}),
    });
    if (!profileRes.ok) {
      return res.status(500).json({ error: "获取用户信息失败" });
    }
    const profileData = await profileRes.json() as any;
    const user = profileData.user || {};
    const teamId = String(user.id || "");
    const username = user.username || user.email || email;

    if (!teamId) return res.status(500).json({ error: "无法获取TeamID" });

    // Auto-update existing account if teamId matches
    const tokenShort = token.slice(-12);
    const existing = await prisma.runwayAccount.findFirst({ where: { teamId } });
    let autoUpdated = false;
    if (existing) {
      await prisma.runwayAccount.update({
        where: { id: existing.id },
        data: { token, tokenShort, isActive: true, lastErrorAt: null, lastErrorMessage: null },
      });
      autoUpdated = true;
      console.log(`[admin:login] auto-updated token for ${existing.label} (teamId=${teamId})`);
    }

    res.json({
      token,
      teamId,
      username,
      email: user.email || email,
      tokenShort,
      autoUpdated,
      accountId: existing?.id || null,
      accountLabel: existing?.label || null,
    });
  } catch (e: any) {
    res.status(500).json({ error: `登录异常: ${e.message}` });
  }
});


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

// ============== JOBS ==============

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
        include: { user: { select: { id: true, username: true } }, account: { select: { id: true, label: true, tokenShort: true } } },
      }),
      prisma.runwayJob.count({ where }),
    ]);
    res.json({ jobs, total, page: Number(page), limit: Number(limit) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ============== LOGS ==============

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

// ============== DASHBOARD ==============

// GET /api/runway/admin/dashboard
router.get("/dashboard", async (_req: Request, res: Response) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const notDeleted = { not: "deleted" };
    const hourAgo = new Date(Date.now() - 3600_000);
    const [totalUsers, activeUsers, totalJobs, todayJobs, queuedJobs, processingJobs, completedJobs, failedJobs, todayCompleted, todayFailed, recentJobs, hourlyCompleted, hourlyByAccount, hourlyByUser] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.runwayJob.count({ where: { status: notDeleted } }),
      prisma.runwayJob.count({ where: { createdAt: { gte: todayStart }, status: notDeleted } }),
      prisma.runwayJob.count({ where: { status: { in: ["pending", "queued"] } } }),
      prisma.runwayJob.count({ where: { status: { in: ["submitted", "processing"] } } }),
      prisma.runwayJob.count({ where: { status: "completed" } }),
      prisma.runwayJob.count({ where: { status: "failed" } }),
      prisma.runwayJob.count({ where: { status: "completed", createdAt: { gte: todayStart } } }),
      prisma.runwayJob.count({ where: { status: "failed", createdAt: { gte: todayStart } } }),
      prisma.runwayJob.findMany({
        where: { createdAt: { gte: todayStart }, status: notDeleted },
        select: { userId: true, status: true },
      }),
      prisma.runwayJob.count({ where: { status: "completed", finishedAt: { gte: hourAgo } } }),
      prisma.runwayJob.groupBy({ by: ["accountId"], where: { status: "completed", finishedAt: { gte: hourAgo }, accountId: { not: null } }, _count: { _all: true } }),
      prisma.runwayJob.groupBy({ by: ["userId"], where: { status: "completed", finishedAt: { gte: hourAgo }, userId: { not: null } }, _count: { _all: true } }),
    ]);
    const hourlyByAccountMap: Record<string, number> = {};
    for (const e of hourlyByAccount) { if (e.accountId) hourlyByAccountMap[e.accountId] = e._count._all; }
    const hourlyByUserMap: Record<string, number> = {};
    for (const e of hourlyByUser) { if (e.userId) hourlyByUserMap[e.userId] = e._count._all; }

    // Per-user today stats
    const userTodayMap: Record<string, { total: number; completed: number; failed: number }> = {};
    for (const j of recentJobs) {
      const uid = j.userId || "__none__";
      if (!userTodayMap[uid]) userTodayMap[uid] = { total: 0, completed: 0, failed: 0 };
      userTodayMap[uid].total++;
      if (j.status === "completed") userTodayMap[uid].completed++;
      if (j.status === "failed") userTodayMap[uid].failed++;
    }

    // Per-user total job counts (exclude deleted)
    const userJobCounts = await prisma.runwayJob.groupBy({
      by: ["userId"],
      where: { status: { not: "deleted" } },
      _count: { id: true },
    });

    // Per-user active (submitted/processing) job counts — for real-time concurrency display
    const activeByUser = await prisma.runwayJob.groupBy({
      by: ["userId"],
      where: { status: { in: ["submitted", "processing"] } },
      _count: { id: true },
    });
    const activeByUserMap: Record<string, number> = {};
    for (const entry of activeByUser) {
      if (entry.userId) activeByUserMap[entry.userId] = entry._count.id;
    }

    // Get user info
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
        currentActive: activeByUserMap[u.id] || 0,
        hourlyCompleted: hourlyByUserMap[u.id] || 0,
      };
    });

    // Account stats for dashboard
    const accounts = await prisma.runwayAccount.findMany({
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
    // Get recent jobs per account (active first, then recent completed, max 5 per account)
    const accountRecentJobs = await prisma.runwayJob.findMany({
      where: { accountId: { not: null }, status: { not: "deleted" } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, accountId: true, userId: true, status: true, progress: true, prompt: true, createdAt: true, updatedAt: true, user: { select: { username: true } } },
    });
    const accountTasksMap: Record<string, Array<{ jobId: string; username: string; status: string; progress: number; prompt: string; createdAt: string }>> = {};
    for (const j of accountRecentJobs) {
      if (!j.accountId) continue;
      if (!accountTasksMap[j.accountId]) accountTasksMap[j.accountId] = [];
      if (accountTasksMap[j.accountId].length >= 5) continue;
      accountTasksMap[j.accountId].push({
        jobId: j.id.slice(0, 8),
        username: j.user?.username || "unknown",
        status: j.status,
        progress: j.progress || 0,
        prompt: (j.prompt || "").slice(0, 30),
        createdAt: j.createdAt.toISOString(),
      });
    }
    const accountStats = await Promise.all(accounts.map(async a => {
      const current = await redis.get(`account:concurrency:${a.id}`);
      const tasks = accountTasksMap[a.id] || [];
      return {
        id: a.id,
        label: a.label,
        tokenShort: a.tokenShort,
        isActive: a.isActive,
        maxConcurrency: a.maxConcurrency,
        currentConcurrency: current ? parseInt(current, 10) : 0,
        totalGenerated: a.totalGenerated,
        hourlyGenerated: hourlyByAccountMap[a.id] || 0,
        activeTasks: tasks,
      };
    }));

    const totalMaxConcurrency = accounts.filter(a => a.isActive).reduce((sum, a) => sum + a.maxConcurrency, 0);
    const totalCurrentConcurrency = accountStats.reduce((sum, a) => sum + a.currentConcurrency, 0);

    // Read global speed multiplier
    let speedMultiplier = 1.0;
    try {
      const spRaw = await redis.get("runway:speed-multiplier");
      if (spRaw) {
        const f = parseFloat(spRaw);
        if (isFinite(f) && !isNaN(f)) speedMultiplier = Math.max(0.1, Math.min(2.0, f));
      }
    } catch {}

    res.json({
      overview: {
        totalUsers, activeUsers, totalJobs, todayJobs, queuedJobs, processingJobs, completedJobs, failedJobs, todayCompleted, todayFailed,
        hourlyCompleted,
        totalAccounts: accounts.length,
        activeAccounts: accounts.filter(a => a.isActive).length,
        totalMaxConcurrency,
        totalCurrentConcurrency,
        speedMultiplier,
      },
      userStats,
      accountStats,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// === Device & IP Management ===

// GET /api/runway/admin/devices — all devices for all users
router.get("/devices", async (_req: Request, res: Response) => {
  try {
    const devices = await DeviceService.getAllDevices();
    res.json(devices);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/runway/admin/devices/user/:userId — devices for specific user
router.get("/devices/user/:userId", async (req: Request, res: Response) => {
  try {
    const devices = await DeviceService.getUserDevices(req.params.userId);
    res.json(devices);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/runway/admin/devices/:id — trust/block/unblock a device
router.put("/devices/:id", async (req: Request, res: Response) => {
  try {
    const { action } = req.body; // "trust" | "block" | "unblock"
    if (!["trust", "block", "unblock"].includes(action)) {
      return res.status(400).json({ error: "action 必须是 trust/block/unblock" });
    }
    const device = await DeviceService.updateDeviceStatus(req.params.id, action);
    res.json(device);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/runway/admin/devices/:id — remove a device
router.delete("/devices/:id", async (req: Request, res: Response) => {
  try {
    await DeviceService.removeDevice(req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/runway/admin/sessions/suspicious — all suspicious login sessions
router.get("/sessions/suspicious", async (_req: Request, res: Response) => {
  try {
    const sessions = await DeviceService.getSuspiciousSessions();
    res.json(sessions);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/runway/admin/sessions/user/:userId — login sessions for specific user
router.get("/sessions/user/:userId", async (req: Request, res: Response) => {
  try {
    const sessions = await DeviceService.getUserSessions(req.params.userId, 50);
    res.json(sessions);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============== GLOBAL SPEED MULTIPLIER ==============

// GET /api/runway/admin/speed — read current global speed multiplier
router.get("/speed", async (_req: Request, res: Response) => {
  try {
    let multiplier = 1.0;
    const raw = await redis.get("runway:speed-multiplier");
    if (raw) {
      const f = parseFloat(raw);
      if (isFinite(f) && !isNaN(f)) multiplier = Math.max(0.1, Math.min(2.0, f));
    }
    res.json({ multiplier });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/runway/admin/speed — set global speed multiplier (0.1..2.0)
router.post("/speed", async (req: Request, res: Response) => {
  try {
    const raw = req.body?.multiplier;
    const f = typeof raw === "number" ? raw : parseFloat(raw);
    if (!isFinite(f) || isNaN(f)) return res.status(400).json({ error: "multiplier 必须是数字" });
    if (f < 0.1 || f > 2.0) return res.status(400).json({ error: "multiplier 必须在 0.1 到 2.0 之间" });
    const clamped = Math.max(0.1, Math.min(2.0, f));
    await redis.set("runway:speed-multiplier", String(clamped));
    console.log(`[admin] global speed multiplier set to ${clamped}x by ${(req as any).user?.username || 'unknown'}`);
    res.json({ ok: true, multiplier: clamped });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export { router as adminRouter };
