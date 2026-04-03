import "dotenv/config";
// Import shared instances BEFORE workers so they use the same connections
import { prisma, redis, accountPool } from "./services/shared";
import "./workers/submit.worker";
import "./workers/poll.worker";
import { Queue } from "bullmq";
import { RunwayDirectClient } from "./services/runway.direct";
import fs from "fs";
import path from "path";

console.log("[runway-worker] started (multi-account mode)");

const submitQueue = new Queue("runway-submit", { connection: redis });
const pollQueue = new Queue("runway-poll", { connection: redis });

async function recoverStuckJobs() {
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

      // processing + remoteTaskId → 加入 poll 队列
      if (j.status === "processing" && j.remoteTaskId) {
        await pollQueue.add("poll", {
          jobId: job.id,
          remoteTaskId: j.remoteTaskId,
          accountId: j.accountId || undefined,
        }, { delay: 5000 });
        console.log(`[startup-recovery] ${job.id.slice(0,8)} processing → poll queue`);
        continue;
      }

      // pending/queued/submitted → 加入 submit 队列
      const existing = await submitQueue.getJob(`submit-${job.id}`);
      if (existing) {
        const state = await existing.getState();
        if (["waiting", "delayed", "active"].includes(state)) {
          console.log(`[startup-recovery] ${job.id.slice(0,8)} already in submit queue (${state}), skip`);
          continue;
        }
        await existing.remove();
        console.log(`[startup-recovery] ${job.id.slice(0,8)} removed stale ${state} job`);
      }
      await prisma.runwayJob.update({
        where: { id: job.id },
        data: { status: "pending", errorMessage: null },
      });
      await submitQueue.add("submit", {
        jobId: job.id,
        duration: j.duration || 5,
        resolution: j.resolution,
        quality: j.quality,
        cfgScale: j.cfgScale,
        sound: j.sound,
        videoUrl: j.videoUrl,
      }, {
        jobId: `submit-${job.id}`, delay: 2000, attempts: 60, backoff: { type: "custom" },
      });
      console.log(`[startup-recovery] ${job.id.slice(0,8)} → submit queue`);
    }
  } catch (e) {
    console.error("[startup-recovery] error:", e);
  }
}

// Reconciliation: sync Redis counters with actual Runway API state every 60s
function startReconciliation() {
  const getActive = async (token: string, teamId: string, proxyUrl?: string): Promise<number> => {
    const client = new RunwayDirectClient(token, Number(teamId), proxyUrl);
    return client.getActiveConcurrency();
  };

  setInterval(async () => {
    try {
      await accountPool.reconcile(getActive);
    } catch (e: any) {
      console.warn("[reconcile] error:", e.message);
    }
  }, 60000);

  // Initial reconciliation after 10s
  setTimeout(async () => {
    try {
      await accountPool.reconcile(getActive);
      console.log("[reconcile] initial reconciliation done");
    } catch (e: any) {
      console.warn("[reconcile] initial error:", e.message);
    }
  }, 10000);
}

// Video cache cleanup: delete cached videos older than N days
const VIDEOS_DIR = "/root/runway/uploads/videos";
const CACHE_MAX_AGE_DAYS = Number(process.env.VIDEO_CACHE_DAYS) || 30;

function startCacheCleanup() {
  const cleanup = () => {
    try {
      if (!fs.existsSync(VIDEOS_DIR)) return;
      const files = fs.readdirSync(VIDEOS_DIR);
      const cutoff = Date.now() - CACHE_MAX_AGE_DAYS * 86400000;
      let deleted = 0;
      for (const file of files) {
        try {
          const filePath = path.join(VIDEOS_DIR, file);
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
            deleted++;
          }
        } catch {}
      }
      if (deleted > 0) {
        console.log(`[cache-cleanup] deleted ${deleted} video(s) older than ${CACHE_MAX_AGE_DAYS}d`);
      }
    } catch (e: any) {
      console.error("[cache-cleanup] error:", e.message);
    }
  };
  setTimeout(cleanup, 30000);
  setInterval(cleanup, 3600000);
}

setTimeout(recoverStuckJobs, 3000);
setTimeout(startReconciliation, 5000);
setTimeout(startCacheCleanup, 8000);
