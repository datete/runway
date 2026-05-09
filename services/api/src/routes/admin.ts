import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import IORedis from "ioredis";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { prisma } from "../services/prisma";
import { DeviceService } from "../services/device.service";
import { adminMiddleware } from "../middleware/auth";

const router = Router();
const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});
const execFileAsync = promisify(execFile);

const RUNWAY_ROOT = process.env.RUNWAY_ROOT || "/root/runway";
const UPLOAD_ROOT = process.env.RUNWAY_UPLOAD_ROOT || path.join(RUNWAY_ROOT, "uploads");
const VIDEO_CACHE_DIR = process.env.MEDIA_CACHE_DIR || path.join(UPLOAD_ROOT, "videos");
const CAPTURES_DIR = path.join(RUNWAY_ROOT, "captures");
const VIDEO_CACHE_FILE_RE = /^(?:[a-f0-9]{40}|video_[a-f0-9]{8}_\d+)\.mp4$/;
const CONTENT_REVIEW_KEY = "runway:content-review-enabled";

type StorageBucket = {
  path: string;
  exists: boolean;
  bytes: number;
  files: number;
  dirs: number;
};

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function getContentReviewEnabled(): Promise<boolean> {
  const raw = await redis.get(CONTENT_REVIEW_KEY);
  return raw === null ? true : raw === "1";
}

async function summarizeTree(root: string, includeFile?: (name: string, fullPath: string) => boolean): Promise<StorageBucket> {
  const summary: StorageBucket = { path: root, exists: false, bytes: 0, files: 0, dirs: 0 };
  if (!(await exists(root))) return summary;
  summary.exists = true;

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        summary.dirs++;
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (includeFile && !includeFile(entry.name, fullPath)) continue;
      try {
        const stat = await fs.stat(fullPath);
        summary.files++;
        summary.bytes += stat.size;
      } catch {}
    }
  }

  await walk(root);
  return summary;
}

async function summarizeTopLevelFiles(root: string, includeFile: (name: string) => boolean): Promise<StorageBucket> {
  const summary: StorageBucket = { path: root, exists: false, bytes: 0, files: 0, dirs: 0 };
  if (!(await exists(root))) return summary;
  summary.exists = true;
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !includeFile(entry.name)) continue;
    try {
      const stat = await fs.stat(path.join(root, entry.name));
      summary.files++;
      summary.bytes += stat.size;
    } catch {}
  }
  return summary;
}

async function readDiskStats(targetPath: string) {
  const probePath = await exists(targetPath) ? targetPath : RUNWAY_ROOT;
  const { stdout } = await execFileAsync("df", ["-Pk", probePath]);
  const line = stdout.trim().split("\n")[1];
  const parts = line.trim().split(/\s+/);
  const totalBytes = Number(parts[1]) * 1024;
  const usedBytes = Number(parts[2]) * 1024;
  const availableBytes = Number(parts[3]) * 1024;
  return {
    path: probePath,
    filesystem: parts[0],
    mount: parts[5],
    totalBytes,
    usedBytes,
    availableBytes,
    usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
  };
}

async function buildStorageReport() {
  const [disk, uploads, videoCache, tempUploads, captures, cachedJobs, localOnlyCachedJobs] = await Promise.all([
    readDiskStats(UPLOAD_ROOT),
    summarizeTree(UPLOAD_ROOT),
    summarizeTree(VIDEO_CACHE_DIR, (name) => VIDEO_CACHE_FILE_RE.test(name)),
    summarizeTopLevelFiles(UPLOAD_ROOT, (name) => name.startsWith("upload_")),
    summarizeTree(CAPTURES_DIR),
    prisma.runwayJob.count({ where: { resultUrl: { startsWith: "/img/videos/" } } as any }),
    prisma.runwayJob.count({
      where: {
        resultUrl: { startsWith: "/img/videos/" },
        OR: [{ videoUrl: null }, { videoUrl: "" }],
      } as any,
    }),
  ]);
  return {
    disk,
    uploads,
    videoCache,
    tempUploads,
    captures,
    cachedJobs: {
      total: cachedJobs,
      localOnly: localOnlyCachedJobs,
      withRemoteFallback: Math.max(0, cachedJobs - localOnlyCachedJobs),
    },
    updatedAt: new Date().toISOString(),
  };
}

async function clearVideoCacheFiles(protectedFiles = new Set<string>()) {
  const result = { files: 0, bytes: 0, protectedFiles: protectedFiles.size, errors: [] as string[] };
  if (!(await exists(VIDEO_CACHE_DIR))) return result;
  const entries = await fs.readdir(VIDEO_CACHE_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !VIDEO_CACHE_FILE_RE.test(entry.name)) continue;
    if (protectedFiles.has(entry.name)) continue;
    const fullPath = path.join(VIDEO_CACHE_DIR, entry.name);
    try {
      const stat = await fs.stat(fullPath);
      await fs.unlink(fullPath);
      result.files++;
      result.bytes += stat.size;
    } catch (e: any) {
      result.errors.push(`${entry.name}: ${e.message}`);
    }
  }
  return result;
}

async function getLocalOnlyCacheFiles() {
  const rows = await prisma.runwayJob.findMany({
    where: {
      resultUrl: { startsWith: "/img/videos/" },
      OR: [{ videoUrl: null }, { videoUrl: "" }],
    } as any,
    select: { resultUrl: true },
  });
  const protectedFiles = new Set<string>();
  for (const row of rows) {
    if (!row.resultUrl) continue;
    const filename = path.basename(row.resultUrl.split("?")[0]);
    if (VIDEO_CACHE_FILE_RE.test(filename)) protectedFiles.add(filename);
  }
  return protectedFiles;
}

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
      select: { id: true, accountId: true, userId: true, status: true, progress: true, prompt: true, referenceImages: true, thumbnailUrl: true, videoUrl: true, createdAt: true, updatedAt: true, user: { select: { username: true } } },
    });
    const accountTasksMap: Record<string, Array<{ jobId: string; username: string; status: string; progress: number; prompt: string; referenceImages: any; thumbnailUrl: string | null; videoUrl: string | null; createdAt: string }>> = {};
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
        referenceImages: j.referenceImages || null,
        thumbnailUrl: (j as any).thumbnailUrl || null,
        videoUrl: (j as any).videoUrl || null,
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
        proxyId: a.proxyId,
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
  const { label, token, teamId, proxyId, maxConcurrency = 2, priority = 0 } = req.body;
  let { proxyUrl } = req.body;
  if (proxyId) {
    const pr = await prisma.proxy.findUnique({ where: { id: proxyId } });
    if (!pr) return res.status(400).json({ error: "代理不存在" });
    proxyUrl = pr.url;
  }
  if (!label || !token || !teamId) return res.status(400).json({ error: "label, token, teamId 必填" });
  try {
    const tokenShort = token.slice(-12);
    const account = await prisma.runwayAccount.create({
      data: { label, token, tokenShort, teamId: String(teamId), proxyUrl: proxyUrl || null, proxyId: proxyId || null, maxConcurrency, priority },
    });
    res.status(201).json({ id: account.id, label: account.label, tokenShort: account.tokenShort, teamId: account.teamId });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PUT /api/runway/admin/accounts/:id — Update an account
router.put("/accounts/:id", async (req: Request, res: Response) => {
  const { label, token, teamId, proxyId, maxConcurrency, priority, isActive, tokenExpiresAt } = req.body;
  let { proxyUrl } = req.body;
  if (proxyId !== undefined && proxyId) {
    const pr = await prisma.proxy.findUnique({ where: { id: proxyId } });
    if (!pr) return res.status(400).json({ error: "代理不存在" });
    proxyUrl = pr.url;
  }
  try {
    const data: any = {};
    if (label !== undefined) data.label = label;
    if (token !== undefined) { data.token = token; data.tokenShort = token.slice(-12); }
    if (teamId !== undefined) data.teamId = String(teamId);
    if (proxyUrl !== undefined) data.proxyUrl = proxyUrl || null;
    if (proxyId !== undefined) data.proxyId = proxyId || null;
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

// DELETE /api/runway/admin/accounts/:id
// Two-stage: active -> deactivate (soft). Already inactive -> hard delete.
router.delete("/accounts/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const acc = await prisma.runwayAccount.findUnique({ where: { id } });
    if (!acc) return res.status(404).json({ error: "account not found" });
    if (acc.isActive) {
      await prisma.runwayAccount.update({ where: { id }, data: { isActive: false } });
      await redis.del(`account:concurrency:${id}`);
      await redis.del(`account:cooldown:${id}`);
      return res.json({ ok: true, stage: "deactivated", message: "账号已停用，再次点击移除将彻底删除" });
    }
    await prisma.runwayJob.updateMany({ where: { accountId: id }, data: { accountId: null } });
    await prisma.runwayAccount.delete({ where: { id } });
    await redis.del(`account:concurrency:${id}`);
    await redis.del(`account:cooldown:${id}`);
    res.json({ ok: true, stage: "deleted" });
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

// POST /api/runway/admin/jobs/:id/kill — Force kill a single job
router.post("/jobs/:id/kill", async (req: Request, res: Response) => {
  try {
    const job = await prisma.runwayJob.findUnique({ where: { id: req.params.id } });
    if (!job) return res.status(404).json({ error: "任务不存在" });
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled" || job.status === "deleted") {
      return res.status(400).json({ error: `任务已是终态: ${job.status}` });
    }
    await prisma.runwayJob.update({
      where: { id: req.params.id },
      data: { status: "failed", errorMessage: `管理员 ${req.user?.username || "unknown"} 手动终止` },
    });
    // Release account concurrency slot in Redis
    if (job.accountId) {
      const key = `account:concurrency:${job.accountId}`;
      const current = await redis.get(key);
      if (current && parseInt(current, 10) > 0) {
        await redis.decr(key);
      }
    }
    console.log(`[admin] job ${req.params.id} killed by ${req.user?.username}, was ${job.status} on account ${job.accountId}`);
    res.json({ ok: true, jobId: req.params.id, previousStatus: job.status });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/runway/admin/jobs/kill-stuck — Batch kill all stuck jobs (processing/submitted too long)
router.post("/jobs/kill-stuck", async (req: Request, res: Response) => {
  try {
    const minutes = Number(req.body?.minutes) || 30;
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    // Find stuck jobs first to release their Redis slots
    const stuckJobs = await prisma.runwayJob.findMany({
      where: {
        status: { in: ["processing", "submitted"] },
        updatedAt: { lt: cutoff },
      },
      select: { id: true, status: true, accountId: true },
    });
    if (stuckJobs.length === 0) {
      return res.json({ ok: true, killed: 0, message: `没有超过 ${minutes} 分钟的卡住任务` });
    }
    // Batch update to failed
    const result = await prisma.runwayJob.updateMany({
      where: {
        status: { in: ["processing", "submitted"] },
        updatedAt: { lt: cutoff },
      },
      data: {
        status: "failed",
        errorMessage: `管理员 ${req.user?.username || "unknown"} 批量清理卡住任务 (>${minutes}min)`,
      },
    });
    // Release Redis concurrency slots
    const accountIds = [...new Set(stuckJobs.filter(j => j.accountId).map(j => j.accountId!))];
    for (const accountId of accountIds) {
      const count = stuckJobs.filter(j => j.accountId === accountId).length;
      const key = `account:concurrency:${accountId}`;
      const current = await redis.get(key);
      if (current) {
        const newVal = Math.max(0, parseInt(current, 10) - count);
        await redis.set(key, String(newVal));
      }
    }
    console.log(`[admin] killed ${result.count} stuck jobs (>${minutes}min) by ${req.user?.username}`);
    res.json({ ok: true, killed: result.count, accounts: accountIds.length, cutoffMinutes: minutes });
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
      prisma.runwayJob.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.runwayJob.count({ where: { status: { in: ["pending", "queued"] } } }),
      prisma.runwayJob.count({ where: { status: { in: ["submitted", "processing"] } } }),
      prisma.runwayJob.count({ where: { status: "completed" } }),
      prisma.runwayJob.count({ where: { status: "failed" } }),
      prisma.runwayJob.count({
        where: {
          finishedAt: { gte: todayStart },
          OR: [
            { status: "completed" },
            { status: "deleted", OR: [{ resultUrl: { not: null } }, { videoUrl: { not: null } }] },
          ],
        },
      }),
      prisma.runwayJob.count({ where: { status: "failed", finishedAt: { gte: todayStart } } }),
      prisma.runwayJob.findMany({
        where: {
          OR: [
            { createdAt: { gte: todayStart } },
            { finishedAt: { gte: todayStart }, status: { in: ["completed", "failed", "deleted"] } },
          ],
        },
        select: { userId: true, status: true, createdAt: true, finishedAt: true, resultUrl: true, videoUrl: true },
      }),
      prisma.runwayJob.count({ where: { status: "completed", finishedAt: { gte: hourAgo } } }),
      prisma.runwayJob.groupBy({ by: ["accountId"], where: { status: "completed", finishedAt: { gte: hourAgo }, accountId: { not: null } }, _count: { _all: true } }),
      prisma.runwayJob.groupBy({ by: ["userId"], where: { status: "completed", finishedAt: { gte: hourAgo }, userId: { not: null } }, _count: { _all: true } }),
    ]);
    const hourlyByAccountMap: Record<string, number> = {};
    for (const e of hourlyByAccount) { if (e.accountId) hourlyByAccountMap[e.accountId] = e._count._all; }
    const hourlyByUserMap: Record<string, number> = {};
    for (const e of hourlyByUser) { if (e.userId) hourlyByUserMap[e.userId] = e._count._all; }

    // Per-user today stats: total = created today including deleted; completion/failure are terminal visible states.
    const userTodayMap: Record<string, { total: number; completed: number; failed: number }> = {};
    for (const j of recentJobs as any[]) {
      const uid = j.userId || "__none__";
      if (!userTodayMap[uid]) userTodayMap[uid] = { total: 0, completed: 0, failed: 0 };
      const createdToday = j.createdAt && new Date(j.createdAt).getTime() >= todayStart.getTime();
      const finishedToday = j.finishedAt && new Date(j.finishedAt).getTime() >= todayStart.getTime();
      if (createdToday) userTodayMap[uid].total++;
      const hasResult = !!(j.resultUrl || j.videoUrl);
      if (finishedToday && (j.status === "completed" || (j.status === "deleted" && hasResult))) userTodayMap[uid].completed++;
      if (finishedToday && j.status === "failed") userTodayMap[uid].failed++;
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
      select: { id: true, accountId: true, userId: true, status: true, progress: true, prompt: true, referenceImages: true, thumbnailUrl: true, videoUrl: true, createdAt: true, updatedAt: true, user: { select: { username: true } } },
    });
    const accountTasksMap: Record<string, Array<{ jobId: string; username: string; status: string; progress: number; prompt: string; referenceImages: any; thumbnailUrl: string | null; videoUrl: string | null; createdAt: string }>> = {};
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
        referenceImages: j.referenceImages || null,
        thumbnailUrl: (j as any).thumbnailUrl || null,
        videoUrl: (j as any).videoUrl || null,
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

    // Read deep-night mode toggle (default: enabled)
    let deepNightEnabled = true;
    try {
      const dnRaw = await redis.get("runway:deep-night-enabled");
      if (dnRaw !== null) deepNightEnabled = dnRaw === "1";
    } catch {}

    let contentReviewEnabled = true;
    try {
      contentReviewEnabled = await getContentReviewEnabled();
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
        deepNightEnabled,
        contentReviewEnabled,
      },
      userStats,
      accountStats,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ============== STORAGE / CACHE ==============

// GET /api/runway/admin/storage — global disk and cache usage
router.get("/storage", async (_req: Request, res: Response) => {
  try {
    res.json(await buildStorageReport());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/runway/admin/storage/clear-cache — clear local video cache only
router.post("/storage/clear-cache", async (req: Request, res: Response) => {
  try {
    const before = await summarizeTree(VIDEO_CACHE_DIR, (name) => VIDEO_CACHE_FILE_RE.test(name));
    const protectedFiles = await getLocalOnlyCacheFiles();
    const removed = await clearVideoCacheFiles(protectedFiles);

    // Keep history playable: local /img/videos/* cache URLs fall back to the original Runway URL when available.
    const relinkedJobs = await prisma.$executeRawUnsafe(`
      UPDATE runway_jobs
      SET result_url = video_url
      WHERE result_url LIKE '/img/videos/%'
        AND video_url IS NOT NULL
        AND video_url <> ''
    `) as number;

    const localOnlyJobs = await prisma.runwayJob.count({
      where: {
        resultUrl: { startsWith: "/img/videos/" },
        OR: [{ videoUrl: null }, { videoUrl: "" }],
      } as any,
    });

    if (req.user?.id) {
      await prisma.userLog.create({
        data: {
          userId: req.user.id,
          action: "clear_cache",
          detail: `removed=${removed.files} bytes=${removed.bytes} relinked=${relinkedJobs}`,
          ip: req.socket.remoteAddress,
        },
      }).catch(() => {});
    }

    console.log(`[admin] clear video cache by ${req.user?.username || "unknown"}: removed=${removed.files}, bytes=${removed.bytes}, relinked=${relinkedJobs}`);
    res.json({
      ok: true,
      before,
      removed,
      relinkedJobs,
      localOnlyJobs,
      storage: await buildStorageReport(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
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

// GET /api/runway/admin/deep-night — read deep-night mode toggle
router.get("/deep-night", async (_req: Request, res: Response) => {
  try {
    const raw = await redis.get("runway:deep-night-enabled");
    const enabled = raw === null ? true : raw === "1";
    res.json({ enabled });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/runway/admin/deep-night — set deep-night mode toggle
router.post("/deep-night", async (req: Request, res: Response) => {
  try {
    const enabled = !!req.body?.enabled;
    await redis.set("runway:deep-night-enabled", enabled ? "1" : "0");
    console.log(`[admin] deep-night mode ${enabled ? "ENABLED" : "DISABLED"} by ${(req as any).user?.username || "unknown"}`);
    res.json({ ok: true, enabled });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/runway/admin/content-review — read local content review toggle
router.get("/content-review", async (_req: Request, res: Response) => {
  try {
    res.json({ enabled: await getContentReviewEnabled() });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/runway/admin/content-review — set local content review toggle
router.post("/content-review", async (req: Request, res: Response) => {
  try {
    const enabled = !!req.body?.enabled;
    await redis.set(CONTENT_REVIEW_KEY, enabled ? "1" : "0");
    console.log(`[admin] content review ${enabled ? "ENABLED" : "DISABLED"} by ${(req as any).user?.username || "unknown"}`);
    res.json({ ok: true, enabled });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});


// ============== PROXY POOL MANAGEMENT ==============

function buildAgent(proxyUrl: string) {
  try {
    if (proxyUrl.startsWith('socks')) {
      const mod = require('socks-proxy-agent');
      return new mod.SocksProxyAgent(proxyUrl);
    }
    const mod = require('https-proxy-agent');
    return new mod.HttpsProxyAgent(proxyUrl);
  } catch (e: any) {
    console.warn('[admin] proxy agent error:', e.message);
    return null;
  }
}

// GET /api/runway/admin/proxies
router.get('/proxies', async (_req: Request, res: Response) => {
  try {
    const proxies = await prisma.proxy.findMany({ orderBy: { createdAt: 'desc' } });
    // attach account count per proxy
    const rows = await prisma.runwayAccount.groupBy({
      by: ['proxyId'],
      _count: { _all: true },
      where: { proxyId: { not: null } },
    });
    const countMap: Record<string, number> = {};
    for (const r of rows) if (r.proxyId) countMap[r.proxyId] = r._count._all;
    res.json(proxies.map(p => ({ ...p, accountCount: countMap[p.id] || 0 })));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/runway/admin/proxies
router.post('/proxies', async (req: Request, res: Response) => {
  const { label, url, isActive = true } = req.body;
  if (!label || !url) return res.status(400).json({ error: 'label 和 url 必填' });
  try {
    const p = await prisma.proxy.create({ data: { label: String(label), url: String(url), isActive: Boolean(isActive) } });
    res.status(201).json(p);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PUT /api/runway/admin/proxies/:id
router.put('/proxies/:id', async (req: Request, res: Response) => {
  const { label, url, isActive } = req.body;
  const data: any = {};
  if (label !== undefined) data.label = String(label);
  if (url !== undefined) data.url = String(url);
  if (isActive !== undefined) data.isActive = Boolean(isActive);
  if (Object.keys(data).length === 0) return res.status(400).json({ error: '无修改内容' });
  try {
    const p = await prisma.proxy.update({ where: { id: req.params.id }, data });
    res.json(p);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/runway/admin/proxies/:id
router.delete('/proxies/:id', async (req: Request, res: Response) => {
  try {
    const used = await prisma.runwayAccount.count({ where: { proxyId: req.params.id } });
    if (used > 0) return res.status(400).json({ error: `该代理正被 ${used} 个账号使用，无法删除` });
    await prisma.proxy.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/runway/admin/proxies/:id/test — test connectivity through this proxy
router.post('/proxies/:id/test', async (req: Request, res: Response) => {
  try {
    const proxy = await prisma.proxy.findUnique({ where: { id: req.params.id } });
    if (!proxy) return res.status(404).json({ error: '代理不存在' });
    const fetchMod = await import('node-fetch');
    const fetchFn = fetchMod.default;
    const agent = buildAgent(proxy.url);
    if (!agent) {
      await prisma.proxy.update({ where: { id: proxy.id }, data: { lastTestedAt: new Date(), lastOk: false, lastError: '代理 URL 无法解析', latencyMs: null } });
      return res.json({ ok: false, message: '代理 URL 无法解析' });
    }
    const target = 'https://api.runwayml.com/';
    const start = Date.now();
    try {
      const r = await fetchFn(target, { agent: agent as any, method: 'GET', timeout: 15000 } as any);
      const latency = Date.now() - start;
      const ok = r.status < 500;
      await prisma.proxy.update({
        where: { id: proxy.id },
        data: { lastTestedAt: new Date(), lastOk: ok, latencyMs: latency, lastError: ok ? null : `HTTP ${r.status}` },
      });
      res.json({ ok, latencyMs: latency, status: r.status, message: ok ? `连接成功 (${latency}ms)` : `HTTP ${r.status}` });
    } catch (err: any) {
      const latency = Date.now() - start;
      await prisma.proxy.update({
        where: { id: proxy.id },
        data: { lastTestedAt: new Date(), lastOk: false, latencyMs: latency, lastError: err.message?.slice(0, 500) || 'unknown' },
      });
      res.json({ ok: false, latencyMs: latency, message: err.message || '连接失败' });
    }
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});



// ============== API KEY MANAGEMENT ==============

// GET /api/runway/admin/api-keys — List all API keys
router.get("/api-keys", async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT ak.id, ak.name, ak.prefix, ak.user_id, ak.rate_limit, ak.enabled,
             ak.last_used_at, ak.expires_at, ak.created_at,
             u.username
      FROM api_keys ak
      LEFT JOIN users u ON u.id = ak.user_id
      ORDER BY ak.created_at DESC
    `) as any[];
    res.json(rows.map(r => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      userId: r.user_id,
      username: r.username,
      rateLimit: r.rate_limit,
      enabled: r.enabled,
      lastUsedAt: r.last_used_at,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    })));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/runway/admin/api-keys — Create new API key
router.post("/api-keys", async (req: Request, res: Response) => {
  try {
    const { name, userId, rateLimit = 60, expiresAt } = req.body;
    if (!name || !userId) return res.status(400).json({ error: "name \u548c userId \u5fc5\u586b" });

    // Generate key: sk- + 48 random chars
    const crypto = require("crypto");
    const rawKey = "sk-" + crypto.randomBytes(32).toString("base64url");
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const prefix = rawKey.slice(0, 8) + "...";

    await prisma.$executeRawUnsafe(
      `INSERT INTO api_keys (id, name, key_hash, prefix, user_id, rate_limit, enabled, expires_at, created_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4::uuid, $5, true, $6, NOW())`,
      name, keyHash, prefix, userId, rateLimit,
      expiresAt ? new Date(expiresAt) : null
    );

    // Return the raw key ONCE - it can never be retrieved again
    res.status(201).json({ key: rawKey, prefix, name });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PUT /api/runway/admin/api-keys/:id — Update API key
router.put("/api-keys/:id", async (req: Request, res: Response) => {
  try {
    const { name, enabled, rateLimit, expiresAt } = req.body;
    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (name !== undefined) { sets.push(`name = $${idx++}`); params.push(name); }
    if (enabled !== undefined) { sets.push(`enabled = $${idx++}`); params.push(Boolean(enabled)); }
    if (rateLimit !== undefined) { sets.push(`rate_limit = $${idx++}`); params.push(Number(rateLimit)); }
    if (expiresAt !== undefined) { sets.push(`expires_at = $${idx++}`); params.push(expiresAt ? new Date(expiresAt) : null); }
    if (sets.length === 0) return res.status(400).json({ error: "\u65e0\u4fee\u6539\u5185\u5bb9" });
    params.push(req.params.id);
    await prisma.$executeRawUnsafe(
      `UPDATE api_keys SET ${sets.join(", ")} WHERE id = $${idx}`,
      ...params
    );
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});



// GET /api/runway/admin/api-keys/logs — recent API call logs
router.get("/api-keys/logs", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) || "100", 10), 500);
    const keyId = (req.query.keyId as string) || null;
    const status = (req.query.status as string) || null; // "success"|"error"|null

    const where: string[] = [];
    const params: any[] = [];
    if (keyId) { where.push(`api_key_id = $${params.length + 1}`); params.push(keyId); }
    if (status === "success") where.push("status_code < 400");
    else if (status === "error") where.push("status_code >= 400");

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        l.id, l.api_key_id, l.user_id, l.method, l.path, l.model,
        l.status_code, l.duration_ms, l.ip_address, l.user_agent,
        l.generation_id, l.error_message, l.created_at,
        ak.name AS key_name, ak.prefix AS key_prefix,
        u.username
      FROM api_call_logs l
      LEFT JOIN api_keys ak ON ak.id = l.api_key_id
      LEFT JOIN users u ON u.id = l.user_id
      ${whereSql}
      ORDER BY l.created_at DESC
      LIMIT ${limit}
    `, ...params) as any[];

    // Summary: calls in last 24h, success/error split
    const summary = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN status_code < 400 THEN 1 END) AS success,
        COUNT(CASE WHEN status_code >= 400 THEN 1 END) AS errors,
        AVG(duration_ms)::int AS avg_duration,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END) AS last_hour
      FROM api_call_logs
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `) as any[];

    res.json({
      logs: rows.map((r: any) => ({
        id: Number(r.id),
        apiKeyId: r.api_key_id,
        keyName: r.key_name,
        keyPrefix: r.key_prefix,
        username: r.username,
        method: r.method,
        path: r.path,
        model: r.model,
        statusCode: r.status_code,
        durationMs: r.duration_ms,
        ipAddress: r.ip_address,
        userAgent: r.user_agent,
        generationId: r.generation_id,
        errorMessage: r.error_message,
        createdAt: r.created_at,
      })),
      summary: summary[0] ? {
        total: Number(summary[0].total),
        success: Number(summary[0].success),
        errors: Number(summary[0].errors),
        avgDuration: Number(summary[0].avg_duration || 0),
        lastHour: Number(summary[0].last_hour),
      } : { total: 0, success: 0, errors: 0, avgDuration: 0, lastHour: 0 },
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/runway/admin/api-keys/stats — API key usage statistics
router.get("/api-keys/stats", async (_req: Request, res: Response) => {
  try {
    // Per-key stats: count of jobs created via API (by checking runway_jobs for API key users)
    const keyStats = await prisma.$queryRawUnsafe(`
      SELECT
        ak.id AS key_id,
        ak.name AS key_name,
        ak.prefix,
        u.username,
        ak.last_used_at,
        ak.created_at,
        COUNT(rj.id) AS total_jobs,
        COUNT(CASE WHEN rj.created_at > NOW() - INTERVAL '24 hours' THEN 1 END) AS jobs_today,
        COUNT(CASE WHEN rj.status = 'completed' THEN 1 END) AS completed,
        COUNT(CASE WHEN rj.status = 'failed' THEN 1 END) AS failed,
        COUNT(CASE WHEN rj.status IN ('pending','queued','processing','submitted') THEN 1 END) AS active
      FROM api_keys ak
      LEFT JOIN users u ON u.id = ak.user_id
      LEFT JOIN runway_jobs rj ON rj.user_id = ak.user_id AND rj.created_at >= ak.created_at
      GROUP BY ak.id, ak.name, ak.prefix, u.username, ak.last_used_at, ak.created_at
      ORDER BY ak.created_at DESC
    `) as any[];

    // Overall API stats
    const overall = await prisma.$queryRawUnsafe(`
      SELECT
        (SELECT COUNT(*) FROM api_keys WHERE enabled = true) AS active_keys,
        (SELECT COUNT(*) FROM api_keys) AS total_keys
    `) as any[];

    res.json({
      keys: keyStats.map((r: any) => ({
        keyId: r.key_id,
        keyName: r.key_name,
        prefix: r.prefix,
        username: r.username,
        lastUsedAt: r.last_used_at,
        createdAt: r.created_at,
        totalJobs: Number(r.total_jobs),
        jobsToday: Number(r.jobs_today),
        completed: Number(r.completed),
        failed: Number(r.failed),
        active: Number(r.active),
      })),
      overall: overall[0] ? {
        activeKeys: Number(overall[0].active_keys),
        totalKeys: Number(overall[0].total_keys),
      } : { activeKeys: 0, totalKeys: 0 },
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/runway/admin/api-keys/:id — Delete API key
router.delete("/api-keys/:id", async (req: Request, res: Response) => {
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM api_keys WHERE id = $1`, req.params.id);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export { router as adminRouter };
