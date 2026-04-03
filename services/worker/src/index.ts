import "dotenv/config";
import "./workers/submit.worker";
import "./workers/poll.worker";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";

console.log("[runway-worker] started");

async function recoverStuckJobs() {
  const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
  const prisma = new PrismaClient();
  const submitQueue = new Queue("runway-submit", { connection });
  const pollQueue = new Queue("runway-poll", { connection });

  try {
    const stuckJobs = await prisma.runwayJob.findMany({
      where: { status: { in: ["pending", "queued", "submitted", "processing"] } },
    });

    if (stuckJobs.length === 0) {
      console.log("[startup-recovery] no stuck jobs");
      return;
    }

    console.log(`[startup-recovery] found ${stuckJobs.length} stuck job(s)`);
    for (const job of stuckJobs) {
      const j = job as any;

      // 已缓存视频直接标记完成
      if (j.resultUrl && j.resultUrl.startsWith("/img/videos/")) {
        await prisma.runwayJob.update({
          where: { id: job.id },
          data: { status: "completed", finishedAt: j.finishedAt || new Date() },
        });
        console.log(`[startup-recovery] ${job.id.slice(0,8)} cached video → completed`);
        continue;
      }

      // processing + remoteTaskId → 加入 poll 队列（幂等，不怕重复）
      if (j.status === "processing" && j.remoteTaskId) {
        await pollQueue.add("poll", { jobId: job.id, remoteTaskId: j.remoteTaskId }, { delay: 5000 });
        console.log(`[startup-recovery] ${job.id.slice(0,8)} processing → poll queue`);
        continue;
      }

      // pending/queued/submitted → 加入 submit 队列，先移除旧的 failed job
      const existing = await submitQueue.getJob(`submit-${job.id}`);
      if (existing) {
        const state = await existing.getState();
        if (["waiting", "delayed", "active"].includes(state)) {
          console.log(`[startup-recovery] ${job.id.slice(0,8)} already in submit queue (${state}), skip`);
          continue;
        }
        // failed/completed 状态 → 移除旧 job，重新创建以使用新 attempts 设置
        await existing.remove();
        console.log(`[startup-recovery] ${job.id.slice(0,8)} removed stale ${state} job`);
      }
      await prisma.runwayJob.update({
        where: { id: job.id },
        data: { status: "pending", errorMessage: null },
      });
      await submitQueue.add("submit", { jobId: job.id, duration: j.duration || 5 }, {
        jobId: `submit-${job.id}`, delay: 2000, attempts: 1000, backoff: { type: "custom" },
      });
      console.log(`[startup-recovery] ${job.id.slice(0,8)} → submit queue`);
    }
  } catch (e) {
    console.error("[startup-recovery] error:", e);
  } finally {
    await prisma.$disconnect();
    await connection.quit();
  }
}

setTimeout(recoverStuckJobs, 3000);
