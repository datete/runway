import "dotenv/config";
// Import shared instances BEFORE workers so they use the same connections
import { prisma, redis, accountPool } from "./services/shared";
import "./workers/submit.worker";
import "./workers/poll.worker";
import { Queue } from "bullmq";
import { triggerSubmit } from "./workers/submit.worker";
import { RunwayDirectClient } from "./services/runway.direct";
import fs from "fs";
import path from "path";

console.log("[runway-worker] started (single-trigger FIFO mode)");

const pollQueue = new Queue("runway-poll", { connection: redis });

/** Create a RunwayDirectClient for a specific account by ID */
async function makeClientForAccount(accountId: string): Promise<RunwayDirectClient | null> {
  const account = await prisma.runwayAccount.findUnique({ where: { id: accountId } });
  if (!account) return null;
  return new RunwayDirectClient(account.token, Number(account.teamId), account.proxyUrl || undefined);
}

async function recoverStuckJobs() {
  try {
    // Step 0: Verify remote task states via Platform API
    // For submitted/processing jobs with remoteTaskId, check if they still exist on Platform
    const activeJobs = await prisma.runwayJob.findMany({
      where: {
        status: { in: ["submitted", "processing"] },
        remoteTaskId: { not: null },
      },
    });

    if (activeJobs.length > 0) {
      console.log(`[startup-recovery] verifying ${activeJobs.length} active job(s) with Platform API...`);
      for (const job of activeJobs) {
        const j = job as any;
        try {
          let client: RunwayDirectClient | null = null;
          if (j.accountId) {
            client = await makeClientForAccount(j.accountId);
          }
          if (!client) {
            client = new RunwayDirectClient();
          }
          const remote = await client.getTask(j.remoteTaskId);

          if (remote.status === 'completed') {
            console.log(`[startup-recovery] ${job.id.slice(0,8)} already completed on Platform, will poll to cache video`);
            // Let poll worker handle caching
          } else if (remote.status === 'failed') {
            console.log(`[startup-recovery] ${job.id.slice(0,8)} failed on Platform: ${remote.errorMessage || 'unknown'}`);
            await prisma.runwayJob.update({
              where: { id: job.id },
              data: {
                status: 'failed',
                errorMessage: remote.errorMessage || '远程任务已失败',
                finishedAt: new Date(),
              },
            });
            if (j.accountId) await accountPool.release(j.accountId, job.id);
            continue; // Don't add to poll queue
          } else {
            console.log(`[startup-recovery] ${job.id.slice(0,8)} remote status: ${remote.status}`);
          }
        } catch (err: any) {
          const errMsg = err.message || String(err);
          if (errMsg.includes('404') || errMsg.includes('Could not find')) {
            console.warn(`[startup-recovery] ${job.id.slice(0,8)} remote task 404, marking failed`);
            await prisma.runwayJob.update({
              where: { id: job.id },
              data: {
                status: 'failed',
                errorMessage: '远程任务不存在(404)，启动时验证失败',
                finishedAt: new Date(),
              },
            });
            if (j.accountId) await accountPool.release(j.accountId, job.id);
            continue;
          }
          // Network error — leave for poll worker to handle
          console.warn(`[startup-recovery] ${job.id.slice(0,8)} API check error: ${errMsg.slice(0, 80)}, will poll normally`);
        }
      }
    }

    // Step 1: Reset queued jobs back to pending (submit worker will pick them up)
    const queuedReset = await prisma.runwayJob.updateMany({
      where: { status: "queued" },
      data: { status: "pending" },
    });
    if (queuedReset.count > 0) {
      console.log(`[startup-recovery] reset ${queuedReset.count} queued job(s) to pending`);
    }

    // Step 2: Find stuck submitted/processing jobs (re-read after Step 0 may have changed some)
    const stuckJobs = await prisma.runwayJob.findMany({
      where: { status: { in: ["submitted", "processing"] } },
    });

    if (stuckJobs.length === 0 && queuedReset.count === 0) {
      console.log("[startup-recovery] no stuck jobs");
    }

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

      // processing/submitted + remoteTaskId -> poll queue (continue tracking)
      if (j.remoteTaskId) {
        await pollQueue.add("poll", {
          jobId: job.id,
          remoteTaskId: j.remoteTaskId,
          accountId: j.accountId || undefined,
        }, { delay: 5000 });
        console.log(`[startup-recovery] ${job.id.slice(0,8)} ${j.status} -> poll queue`);
        continue;
      }

      // submitted/processing WITHOUT remoteTaskId -> reset to pending
      await prisma.runwayJob.update({
        where: { id: job.id },
        data: { status: "pending", errorMessage: null, accountId: null },
      });
      console.log(`[startup-recovery] ${job.id.slice(0,8)} (no remoteTaskId) -> pending`);
    }

    // Reconcile Redis counters with DB
    await accountPool.reconcile();
    console.log("[startup-recovery] reconciled concurrency counters");

    // Check if there are pending jobs and trigger submit once with delay
    const pendingCount = await prisma.runwayJob.count({
      where: { status: "pending" },
    });
    if (pendingCount > 0) {
      // Delay 15-30s to let everything settle before first submission
      const startDelay = 15000 + Math.floor(Math.random() * 15000);
      await triggerSubmit(startDelay);
      console.log(`[startup-recovery] ${pendingCount} pending job(s), first submit in ${Math.round(startDelay/1000)}s`);
    } else {
      console.log("[startup-recovery] no pending jobs, submit worker will wait for triggers");
    }
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

// Periodic stuck-job sweep: safety net if poll chain is broken.
// Finds processing/submitted jobs whose updated_at is older than STUCK_SWEEP_MINUTES
// and re-enqueues them to the poll queue. Poll worker contains all the decision
// logic (progress/timeout/account switching), so this only re-triggers it.
const STUCK_SWEEP_MINUTES = Number(process.env.STUCK_SWEEP_MINUTES) || 60;
const STUCK_SWEEP_INTERVAL_MS = Number(process.env.STUCK_SWEEP_INTERVAL_MS) || 5 * 60 * 1000;
function startStuckSweep() {
  const sweep = async () => {
    try {
      const cutoff = new Date(Date.now() - STUCK_SWEEP_MINUTES * 60 * 1000);
      const stuck = await prisma.runwayJob.findMany({
        where: {
          status: { in: ["submitted", "processing"] },
          updatedAt: { lt: cutoff },
        },
        select: { id: true, status: true, remoteTaskId: true, accountId: true, updatedAt: true } as any,
      });
      if (stuck.length === 0) return;
      for (const job of stuck as any[]) {
        const staleMin = Math.round((Date.now() - new Date(job.updatedAt).getTime()) / 60000);
        if (job.remoteTaskId) {
          await pollQueue.add("poll", {
            jobId: job.id,
            remoteTaskId: job.remoteTaskId,
            accountId: job.accountId || undefined,
          }, { delay: 2000 });
          console.log(`[stuck-sweep] ${String(job.id).slice(0,8)} ${job.status} stale ${staleMin}min -> re-enqueued poll`);
        } else {
          await prisma.runwayJob.update({
            where: { id: job.id },
            data: { status: "pending", startedAt: null, accountId: null, progress: 0 } as any,
          }).catch(() => {});
          if (job.accountId) await accountPool.release(job.accountId, job.id).catch(() => {});
          console.log(`[stuck-sweep] ${String(job.id).slice(0,8)} ${job.status} stale ${staleMin}min (no remoteTaskId) -> pending`);
        }
      }
    } catch (e: any) {
      console.warn("[stuck-sweep] error:", e.message);
    }
  };
  setInterval(sweep, STUCK_SWEEP_INTERVAL_MS);
  setTimeout(sweep, 30000); // initial run after 30s
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

// #6: Captures directory cleanup — delete JSON files older than 7 days
const CAPTURES_DIR = "/root/runway/captures";
const CAPTURES_MAX_AGE_DAYS = 7;

function startCapturesCleanup() {
  const cleanup = () => {
    try {
      if (!fs.existsSync(CAPTURES_DIR)) return;
      const files = fs.readdirSync(CAPTURES_DIR).filter(f => f.endsWith(".json"));
      const cutoff = Date.now() - CAPTURES_MAX_AGE_DAYS * 86400000;
      let deleted = 0;
      for (const file of files) {
        try {
          const filePath = path.join(CAPTURES_DIR, file);
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
            deleted++;
          }
        } catch (e: any) { console.warn("[captures-cleanup] file error:", e.message); }
      }
      if (deleted > 0) {
        console.log(`[captures-cleanup] deleted ${deleted} capture(s) older than ${CAPTURES_MAX_AGE_DAYS}d`);
      }
    } catch (e: any) {
      console.error("[captures-cleanup] error:", e.message);
    }
  };
  setTimeout(cleanup, 35000);
  setInterval(cleanup, 3600000);
}

// Graceful shutdown
async function shutdown() {
  console.log('[worker] shutting down gracefully...');
  try {
    await redis.quit();
    console.log('[worker] Redis closed');
  } catch (e: any) {
    console.warn('[worker] Redis close error:', e.message);
  }
  try {
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
setTimeout(startStuckSweep, 10000);
setTimeout(startUploadCleanup, 10000);
setTimeout(startCapturesCleanup, 12000);
