import { PrismaClient } from "@prisma/client";
import { submitQueue } from "../../queues/runway.queue";
import { v4 as uuidv4 } from "uuid";

const prisma = new PrismaClient();

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

export class RunwayService {
  async createJob(input: CreateJobInput) {
    // Only check hard quota limits — concurrency is enforced by the worker
    if (input.userId) {
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { dailyQuota: true, totalQuota: true },
      });
      if (user) {
        // Daily quota — hard limit
        if (user.dailyQuota !== null) {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayCount = await prisma.runwayJob.count({
            where: { userId: input.userId, createdAt: { gte: todayStart } },
          });
          if (todayCount >= user.dailyQuota) {
            throw new Error(`今日配额已用完（上限 ${user.dailyQuota} 个）`);
          }
        }
        // Total quota — hard limit
        if (user.totalQuota !== null) {
          const totalCount = await prisma.runwayJob.count({
            where: { userId: input.userId },
          });
          if (totalCount >= user.totalQuota) {
            throw new Error(`总提交配额已用完（上限 ${user.totalQuota} 个）`);
          }
        }
      }
    }

    // Always accept the job — it enters the global queue
    const job = await prisma.runwayJob.create({
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

    const existing = await submitQueue.getJob(`submit-${job.id}`);
    if (existing) await existing.remove().catch(() => {});
    await submitQueue.add(
      "submit",
      { jobId: job.id, duration: input.duration, resolution: input.resolution, quality: input.quality, cfgScale: input.cfgScale, sound: input.sound, videoUrl: input.videoUrl },
      { jobId: `submit-${job.id}`, attempts: 60, backoff: { type: "custom" } },
    );
    await prisma.runwayJob.update({ where: { id: job.id }, data: { status: "queued" } });

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
    return prisma.runwayJob.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
  }

  async retryJob(id: string, userId?: string, role?: string) {
    const job = await prisma.runwayJob.findUnique({ where: { id } });
    if (!job) throw new Error("not found");
    if (role !== "admin" && userId && job.userId !== userId) throw new Error("forbidden");
    await prisma.runwayJob.update({
      where: { id },
      data: { status: "pending", errorMessage: null, retryCount: { increment: 1 } },
    });
    const existing = await submitQueue.getJob(`submit-${id}`);
    if (existing) await existing.remove().catch(() => {});
    await submitQueue.add(
      "submit",
      {
        jobId: id,
        duration: (job as any).duration || 5,
        resolution: (job as any).resolution,
        quality: (job as any).quality,
        cfgScale: (job as any).cfgScale,
        sound: (job as any).sound,
        videoUrl: (job as any).videoUrl,
      },
      { jobId: `submit-${id}`, attempts: 60, backoff: { type: "custom" } },
    );
    return prisma.runwayJob.findUnique({ where: { id } });
  }

  async deleteJob(id: string, userId?: string, role?: string) {
    const job = await prisma.runwayJob.findUnique({ where: { id } });
    if (!job) throw new Error("not found");
    if (role !== "admin" && userId && job.userId !== userId) throw new Error("forbidden");
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
    return prisma.runwayJob.update({
      where: { id },
      data: { status: "cancelled", finishedAt: new Date() },
    });
  }
}
