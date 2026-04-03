import { prisma } from "../prisma";
import { submitQueue, pollQueue, redisConnection } from "../../queues/runway.queue";
import { v4 as uuidv4 } from "uuid";
import fetch from "node-fetch";

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

/** Add a single trigger to the submit queue (deduped) */
async function triggerSubmit(delay = 0): Promise<void> {
  try {
    await submitQueue.add("submit-trigger", {}, {
      jobId: `trig-${Date.now()}`,
      delay,
      removeOnComplete: 10,
      removeOnFail: 10,
    });
  } catch {}
}

export class RunwayService {
  async createJob(input: CreateJobInput) {
    // Quota check + job creation in a serializable transaction to prevent races
    const job = await prisma.$transaction(async (tx) => {
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
              where: { userId: input.userId, createdAt: { gte: todayStart } },
            });
            if (todayCount >= user.dailyQuota) {
              throw new Error(`今日配额已用完（上限 ${user.dailyQuota} 个）`);
            }
          }
          // Total quota — hard limit
          if (user.totalQuota !== null) {
            const totalCount = await tx.runwayJob.count({
              where: { userId: input.userId },
            });
            if (totalCount >= user.totalQuota) {
              throw new Error(`总提交配额已用完（上限 ${user.totalQuota} 个）`);
            }
          }
        }
      }

      // Always accept the job — it enters the global queue
      return tx.runwayJob.create({
        data: {
          id: uuidv4(),
          userId: input.userId,
          prompt: input.prompt,
          mode: input.mode,
          imageUrl: input.imageUrl,
          referenceImages: input.imageUrls ? JSON.stringify(input.imageUrls) : undefined,
          exploreMode: input.exploreMode ?? true,
          modelName: "kling_3_0_standard",
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

  async listJobs(userId?: string, role?: string) {
    const where = role === "admin" ? {} : { userId: userId ?? null };
    const include = role === "admin" ? { user: { select: { username: true } } } : undefined;
    const jobs = await prisma.runwayJob.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, include });
    if (role === "admin") {
      return jobs.map((j: any) => ({ ...j, username: j.user?.username || null, user: undefined }));
    }
    return jobs;
  }

  async retryJob(id: string, userId?: string, role?: string) {
    const job = await prisma.runwayJob.findUnique({ where: { id } });
    if (!job) throw new Error("not found");
    if (role !== "admin" && userId && job.userId !== userId) throw new Error("forbidden");
    await prisma.runwayJob.update({
      where: { id },
      data: { status: "pending", errorMessage: null, retryCount: { increment: 1 } },
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
    await prisma.runwayJob.update({
      where: { id },
      data: { status: "cancelled", finishedAt: new Date() },
    }).catch(() => {});
    return prisma.runwayJob.delete({ where: { id } });
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
