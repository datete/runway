import { prisma } from "../prisma";
import { submitQueue, pollQueue, redisConnection } from "../../queues/runway.queue";
import { v4 as uuidv4 } from "uuid";
import fetch from "node-fetch";
import { createHash } from "crypto";

interface CreateJobInput {
  prompt: string;
  mode: string;
  imageUrl?: string;
  imageUrls?: string[];
  duration?: number;
  exploreMode?: boolean;
  model?: string;
  remark?: string;
  userId?: string;
  resolution?: string;
  quality?: string;
  cfgScale?: number;
  sound?: boolean;
  videoUrl?: string;
}

const ACTIVE_STATUSES = ["pending", "queued", "submitted", "processing"];

/** Global prompt dedup: same content max N times per day across all users */
const PROMPT_DAILY_LIMIT = 10;
const PROMPT_TTL = 86400; // 24h

function promptHash(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, ' ').toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

async function checkPromptLimit(prompt: string): Promise<{ allowed: boolean; count: number }> {
  const hash = promptHash(prompt);
  const key = `prompt:global:${hash}`;
  const count = await redisConnection.incr(key);
  if (count === 1) await redisConnection.expire(key, PROMPT_TTL);
  return { allowed: count <= PROMPT_DAILY_LIMIT, count };
}


/** Add a single trigger to the submit queue (deduped) */
async function triggerSubmit(delay = 0): Promise<void> {
  const effectiveDelay = Math.max(delay, 3000);
  try {
    const existing = await submitQueue.getJob("submit-next");
    if (existing) {
      const state = await existing.getState();
      if (state === "delayed" || state === "waiting") {
        const existingFireAt = (existing.timestamp || 0) + (existing.opts?.delay || 0);
        const newFireAt = Date.now() + effectiveDelay;
        if (newFireAt >= existingFireAt) return;
        await existing.remove().catch(() => {});
      }
    }
    await submitQueue.add("submit-trigger", {}, {
      jobId: "submit-next",
      delay: effectiveDelay,
      removeOnComplete: true,
      removeOnFail: true,
    });
  } catch (e: any) {
    if (!e.message?.includes("already exists")) {
      console.warn("[api:triggerSubmit] error:", e.message);
    }
  }
}

export class RunwayService {
  async createJob(input: CreateJobInput) {
    // Quota check + job creation in a serializable transaction to prevent races
    const job = await prisma.$transaction(async (tx) => {
      // ── Global prompt frequency check ──
      const { allowed, count } = await checkPromptLimit(input.prompt);
      if (!allowed) {
        throw new Error("该提示词今日已达上限，请修改后重试");
      }

      if (input.userId) {
        const user = await tx.user.findUnique({
          where: { id: input.userId },
          select: { dailyQuota: true, totalQuota: true },
        });
        if (user) {
          // Daily quota — hard limit
          if (user.dailyQuota !== null) {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayCount = await tx.runwayJob.count({
              where: { userId: input.userId, createdAt: { gte: todayStart }, status: { notIn: ["deleted", "failed", "cancelled"] } },
            });
            if (todayCount >= user.dailyQuota) {
              throw new Error(`今日配额已用完（上限 ${user.dailyQuota} 个）`);
            }
          }
          // Total quota — hard limit
          if (user.totalQuota !== null) {
            const totalCount = await tx.runwayJob.count({
              where: { userId: input.userId, status: { not: "deleted" } },
            });
            if (totalCount >= user.totalQuota) {
              throw new Error(`总提交配额已用完（上限 ${user.totalQuota} 个）`);
            }
          }
        }
      }

      // Always accept the job — it enters the global queue
      const jobId = uuidv4();
      const created = await tx.runwayJob.create({
        data: {
          id: jobId,
          userId: input.userId,
          prompt: input.prompt,
          mode: input.mode,
          imageUrl: input.imageUrl,
          referenceImages: input.imageUrls ? JSON.stringify(input.imageUrls) : undefined,
          exploreMode: input.exploreMode ?? false,
          modelName: input.model || "kling_3_0_pro",
          status: "pending",
          provider: "direct",
          duration: input.duration || 5,
          remark: input.remark,
          resolution: input.resolution || null,
          quality: input.quality || null,
          cfgScale: input.cfgScale ?? null,
          sound: input.sound ?? null,
          videoUrl: input.videoUrl || null,
        } as any,
      });

      // Credit mode (exploreMode=false) gets higher priority — processed before free tasks
      if (input.exploreMode === false) {
        await tx.$executeRawUnsafe(
          `UPDATE runway_jobs SET priority = 10 WHERE id = $1`,
          jobId
        );
      }

      return created;
    }, { isolationLevel: "Serializable" });

    // Trigger the submit worker to pick up pending jobs (FIFO from DB)
    await triggerSubmit();

    // Calculate queue position for immediate feedback
    const queueAhead = await prisma.runwayJob.count({
      where: { status: { in: ACTIVE_STATUSES }, createdAt: { lt: job.createdAt } },
    });

    return { ...job, queuePosition: queueAhead + 1 };
  }

  async getJob(id: string, userId?: string, role?: string) {
    const job = await prisma.runwayJob.findUnique({ where: { id } });
    if (!job) return null;
    if (role !== "admin" && userId && job.userId !== userId) return null;
    return job;
  }

  async listJobs(userId?: string, role?: string, options?: { page?: number; pageSize?: number; status?: string; search?: string; tag?: string }) {
    const page = Math.max(1, options?.page || 1);
    const pageSize = Math.min(100, Math.max(1, options?.pageSize || 20));

    // Base filter: exclude deleted
    const baseWhere: any = role === "admin"
      ? { status: { not: "deleted" }, provider: { not: "borrowed" } }
      : { userId: userId ?? null, status: { not: "deleted" }, provider: { not: "borrowed" } };

    // Status filter from tab
    const statusFilter = options?.status;
    const where: any = { ...baseWhere };
    if (statusFilter === "queued") {
      where.status = { in: ["pending", "queued", "submitted"] };
    } else if (statusFilter === "processing") {
      where.status = "processing";
    } else if (statusFilter === "completed") {
      where.status = "completed";
    } else if (statusFilter === "failed") {
      where.status = { in: ["failed", "cancelled"] };
    }

    // Exact tag (remark) filter
    const tagFilter = options?.tag?.trim();
    if (tagFilter) {
      where.remark = tagFilter;
    }

    // Text search: match prompt, remark, or job id
    const searchTerm = options?.search?.trim();
    if (searchTerm) {
      where.OR = [
        { prompt: { contains: searchTerm, mode: "insensitive" } },
        { remark: { contains: searchTerm, mode: "insensitive" } },
        { id: { contains: searchTerm, mode: "insensitive" } },
      ];
    }

    const include = role === "admin" ? { user: { select: { username: true } } } : undefined;

    // Get counts via single raw SQL, plus paginated jobs
    const isAdmin = role === "admin";
    const userFilter = isAdmin ? "" : ` AND "user_id" = '${userId}'`;
    const visibleFilter = ` AND provider <> 'borrowed'`;
    const countsQuery = (prisma as any).$queryRawUnsafe(`
      SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('deleted')) AS all,
        COUNT(*) FILTER (WHERE status IN ('pending','queued','submitted')) AS queued,
        COUNT(*) FILTER (WHERE status = 'processing') AS processing,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status IN ('failed','cancelled')) AS failed
      FROM runway_jobs WHERE 1=1${userFilter}${visibleFilter}
    `);

    const [jobs, countRows] = await Promise.all([
      prisma.runwayJob.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include }),
      countsQuery,
    ]);
    const cr = countRows[0] || {};
    const counts = {
      all: Number(cr.all || 0),
      queued: Number(cr.queued || 0),
      processing: Number(cr.processing || 0),
      completed: Number(cr.completed || 0),
      failed: Number(cr.failed || 0),
    };
    // Derive total from counts based on status filter
    let total = counts.all;
    if (statusFilter === "queued") total = counts.queued;
    else if (statusFilter === "processing") total = counts.processing;
    else if (statusFilter === "completed") total = counts.completed;
    else if (statusFilter === "failed") total = counts.failed;

    // Fetch priority values (not in Prisma schema, added via raw SQL)
    const jobIds = jobs.map((j: any) => j.id);
    let priorityMap: Record<string, number> = {};
    if (jobIds.length > 0) {
      try {
        const placeholders = jobIds.map((_: any, i: number) => `$${i + 1}::uuid`).join(',');
        const rows: any[] = await (prisma as any).$queryRawUnsafe(
          `SELECT id::text, COALESCE(priority, 0) as priority FROM runway_jobs WHERE id IN (${placeholders})`,
          ...jobIds
        );
        for (const r of rows) priorityMap[r.id] = r.priority;
      } catch (e: any) { console.warn('[listJobs] priority fetch error:', e.message); }
    }

    // Calculate queue positions for pending/queued jobs (by priority DESC, createdAt ASC)
    const queuedJobs = jobs.filter((j: any) => ['pending', 'queued'].includes(j.status));
    const sorted = [...queuedJobs].sort((a: any, b: any) => {
      const pa = priorityMap[a.id] || 0, pb = priorityMap[b.id] || 0;
      if (pb !== pa) return pb - pa;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    const posMap: Record<string, number> = {};
    sorted.forEach((j: any, i: number) => { posMap[j.id] = i + 1; });
    const queueTotal = sorted.length;

    const enriched = jobs.map((j: any) => ({
      ...j,
      priority: priorityMap[j.id] || 0,
      queuePosition: posMap[j.id] || null,
      queueTotal: ['pending', 'queued'].includes(j.status) ? queueTotal : null,
    }));
    if (role === "admin") {
      const data = enriched.map((j: any) => ({ ...j, username: j.user?.username || null, user: undefined }));
      return { jobs: data, total, page, pageSize, counts };
    }
    return { jobs: enriched, total, page, pageSize, counts };
  }

  async retryJob(id: string, userId?: string, role?: string) {
    const job = await prisma.runwayJob.findUnique({ where: { id } });
    if (!job) throw new Error("not found");
    if (role !== "admin" && userId && job.userId !== userId) throw new Error("forbidden");
    await prisma.runwayJob.update({
      where: { id },
      data: { status: "pending", errorMessage: null, retryCount: { increment: 1 }, accountId: null, remoteTaskId: null, startedAt: null, finishedAt: null, executionMode: "local", borrowDispatchId: null, borrowSystemId: null, borrowSystemName: null, borrowStatus: null, borrowErrorCode: null } as any,
    });
    // Trigger the submit worker
    await triggerSubmit();
    return prisma.runwayJob.findUnique({ where: { id } });
  }

  async deleteJob(id: string, userId?: string, role?: string) {
    const job = await prisma.runwayJob.findUnique({ where: { id } });
    if (!job) throw new Error("not found");
    if (role !== "admin" && userId && job.userId !== userId) throw new Error("forbidden");
    // Cancel remote task if running
    await this._cancelRemote(job as any);
    // Clean up BullMQ jobs
    await this._cleanupQueues(id);
    // Release account concurrency if deleting an active job.
    if ((job as any).accountId) {
      await this._releaseAccount((job as any).accountId, id);
    }
    // Soft delete: mark as deleted instead of removing from DB
    // This preserves the record for accurate dashboard statistics
    return prisma.runwayJob.update({
      where: { id },
      data: { status: "deleted", finishedAt: (job as any).finishedAt || new Date() },
    });
  }

  async cancelJob(id: string, userId?: string, role?: string) {
    const job = await prisma.runwayJob.findUnique({ where: { id } });
    if (!job) throw new Error("not found");
    if (role !== "admin" && userId && job.userId !== userId) throw new Error("forbidden");
    // Cancel remote task if running
    await this._cancelRemote(job as any);
    // Clean up BullMQ jobs
    await this._cleanupQueues(id);
    // Release account concurrency if applicable
    if ((job as any).accountId) {
      await this._releaseAccount((job as any).accountId, id);
    }
    return prisma.runwayJob.update({
      where: { id },
      data: { status: "cancelled", finishedAt: new Date() },
    });
  }

  /** Cancel remote Runway task if it has a remoteTaskId */
  private async _cancelRemote(job: any): Promise<void> {
    if (!job.remoteTaskId || !job.accountId) return;
    try {
      const account = await prisma.runwayAccount.findUnique({ where: { id: job.accountId } });
      if (!account) return;

      const headers: Record<string, string> = {
        "Authorization": `Bearer ${account.token}`,
        "Content-Type": "application/json",
        "X-Runway-Workspace": account.teamId,
      };

      // Build proxy agent if needed
      let agent: any;
      if (account.proxyUrl) {
        try {
          if (account.proxyUrl.startsWith('socks')) {
            const { SocksProxyAgent } = await import('socks-proxy-agent');
            agent = new SocksProxyAgent(account.proxyUrl);
          } else {
            const { HttpsProxyAgent } = await import('https-proxy-agent');
            agent = new HttpsProxyAgent(account.proxyUrl);
          }
        } catch {}
      }

      await fetch(`https://api.runwayml.com/v1/tasks/${job.remoteTaskId}/cancel?asTeamId=${account.teamId}`, {
        method: "POST",
        headers,
        ...(agent ? { agent } : {}),
      });
      console.log(`[runway-service] cancelled remote task ${job.remoteTaskId} for job ${job.id.slice(0,8)}`);
    } catch (e: any) {
      console.warn(`[runway-service] cancel remote failed: ${e.message}`);
    }
  }

  /** Remove BullMQ jobs from submit and poll queues */
  private async _cleanupQueues(jobId: string): Promise<void> {
    try {
      const submitJob = await submitQueue.getJob(`submit-${jobId}`);
      if (submitJob) await submitJob.remove().catch(() => {});
    } catch {}
    // Poll jobs have IDs like poll-{jobId}-{timestamp}, search delayed/waiting jobs
    try {
      const delayed = await pollQueue.getDelayed();
      for (const j of delayed) {
        if (j.data?.jobId === jobId) {
          await j.remove().catch(() => {});
          console.log(`[runway-service] removed delayed poll job for ${jobId.slice(0,8)}`);
          break;
        }
      }
    } catch {}
    try {
      const waiting = await pollQueue.getWaiting();
      for (const j of waiting) {
        if (j.data?.jobId === jobId) {
          await j.remove().catch(() => {});
          console.log(`[runway-service] removed waiting poll job for ${jobId.slice(0,8)}`);
          break;
        }
      }
    } catch {}
  }

  /** Release account concurrency slot via Redis */
  private async _releaseAccount(accountId: string, jobId: string): Promise<void> {
    try {
      const releaseKey = `account:released:${accountId}:${jobId}`;
      const alreadyReleased = await redisConnection.set(releaseKey, '1', 'EX', 600, 'NX');
      if (!alreadyReleased) return;
      const key = `account:concurrency:${accountId}`;
      const val = await redisConnection.decr(key);
      if (val < 0) await redisConnection.set(key, '0');
      console.log(`[runway-service] released concurrency for account ${accountId.slice(0,8)}, now ${Math.max(0, val)}`);
    } catch (e: any) {
      console.warn(`[runway-service] release account failed: ${e.message}`);
    }
  }
}
