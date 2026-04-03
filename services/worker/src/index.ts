import "dotenv/config";
// Import shared instances BEFORE workers so they use the same connections
import { prisma, redis, accountPool } from "./services/shared";
import "./workers/submit.worker";
import "./workers/poll.worker";
import { Queue } from "bullmq";
import { triggerSubmit } from "./workers/submit.worker";
import fs from "fs";
import path from "path";

console.log("[runway-worker] started (single-trigger FIFO mode)");

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

      // cached video -> mark completed
      if (j.resultUrl && j.resultUrl.startsWith("/img/videos/")) {
        await prisma.runwayJob.update({
          where: { id: job.id },
          data: { status: "completed", finishedAt: j.finishedAt || new Date() },
        });
        console.log(`[startup-recovery] ${job.id.slice(0,8)} cached video -> completed`);
        continue;
      }

      // processing + remoteTaskId -> poll queue
      if (j.status === "processing" && j.remoteTaskId) {
        await pollQueue.add("poll", {
          jobId: job.id,
          remoteTaskId: j.remoteTaskId,
          accountId: j.accountId || undefined,
        }, { delay: 5000 });
        console.log(`[startup-recovery] ${job.id.slice(0,8)} processing -> poll queue`);
        continue;
      }

      // pending/queued/submitted -> reset to pending
      await prisma.runwayJob.update({
        where: { id: job.id },
        data: { status: "pending", errorMessage: null },
      });
      console.log(`[startup-recovery] ${job.id.slice(0,8)} -> pending`);
    }

    // Reconcile Redis counters with DB BEFORE triggering submit
    // This fixes leaked concurrency slots from crashed workers
    await accountPool.reconcile();
    console.log("[startup-recovery] reconciled concurrency counters");

    // Single trigger to process all pending jobs in FIFO order
    await triggerSubmit(2000);
    console.log("[startup-recovery] triggered submit worker");
  } catch (e) {
    console.error("[startup-recovery] error:", e);
  }
}

// Reconciliation: sync Redis counters with our DB active job count every 60s
function startReconciliation() {
  setInterval(async () => {
    try {
      await accountPool.reconcile();
    } catch (e: any) {
      console.warn("[reconcile] error:", e.message);
    }
  }, 60000);

  // Initial reconciliation after 10s
  setTimeout(async () => {
    try {
      await accountPool.reconcile();
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
        } catch (e: any) { console.warn('[cache-cleanup] file error:', e.message); }
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

// Upload cleanup
const UPLOADS_DIR = "/root/runway/uploads";
const UPLOAD_MAX_AGE_DAYS = Number(process.env.UPLOAD_CACHE_DAYS) || 7;

function startUploadCleanup() {
  const cleanup = () => {
    try {
      if (!fs.existsSync(UPLOADS_DIR)) return;
      const files = fs.readdirSync(UPLOADS_DIR).filter(f => f.startsWith("upload_"));
      const cutoff = Date.now() - UPLOAD_MAX_AGE_DAYS * 86400000;
      let deleted = 0;
      for (const file of files) {
        try {
          const filePath = path.join(UPLOADS_DIR, file);
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
            deleted++;
          }
        } catch (e: any) { console.warn('[upload-cleanup] file error:', e.message); }
      }
      if (deleted > 0) {
        console.log(`[upload-cleanup] deleted ${deleted} file(s) older than ${UPLOAD_MAX_AGE_DAYS}d`);
      }
    } catch (e: any) {
      console.error("[upload-cleanup] error:", e.message);
    }
  };
  setTimeout(cleanup, 30000);
  setInterval(cleanup, 3600000);
}

// Graceful shutdown
async function shutdown() {
  console.log('[worker] shutting down gracefully...');
  try {
    // Close Redis connection
    await redis.quit();
    console.log('[worker] Redis closed');
  } catch (e: any) {
    console.warn('[worker] Redis close error:', e.message);
  }
  try {
    // Close Prisma
    await prisma.$disconnect();
    console.log('[worker] Prisma disconnected');
  } catch (e: any) {
    console.warn('[worker] Prisma disconnect error:', e.message);
  }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

setTimeout(recoverStuckJobs, 3000);
setTimeout(startReconciliation, 5000);
setTimeout(startCacheCleanup, 8000);
setTimeout(startUploadCleanup, 10000);
