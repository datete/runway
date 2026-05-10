import { Worker, Job, Queue } from 'bullmq';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { RunwayDirectClient } from '../services/runway.direct';
import { prisma, redis as connection, accountPool } from '../services/shared';
import { triggerSubmit } from './submit.worker';
import { translateRunwayError } from '../utils/errorTranslator';


// Human-like delay before triggering next submit (45-120s after slot freed)
function humanSubmitDelay(): number {
  return 45000 + Math.floor(Math.random() * 75000);
}

const JOB_HISTORY_LIMIT = Number(process.env.BULLMQ_HISTORY_LIMIT) || 1000;
const pollQueue = new Queue('runway-poll', {
  connection,
  defaultJobOptions: { removeOnComplete: true, removeOnFail: JOB_HISTORY_LIMIT },
});

function pollJobOptions(jobId: string, delay: number, suffix = `${Date.now()}`) {
  return {
    jobId: `poll-${jobId}-${suffix}`,
    delay,
    removeOnComplete: true,
    removeOnFail: JOB_HISTORY_LIMIT,
  };
}

// Max auto-retries when remote task fails (prevents infinite loop)
const MAX_REMOTE_RETRIES = 10;
// Max time a job can stay in processing/generating before auto-retry.
const MAX_PROCESSING_MINUTES = Number(process.env.MAX_PROCESSING_MINUTES) || 120;
const PROGRESS_STALL_MINUTES = Number(process.env.PROGRESS_STALL_MINUTES) || 120;
const ZERO_PROGRESS_TIMEOUT_MINUTES = Number(process.env.ZERO_PROGRESS_TIMEOUT_MINUTES) || 120;
const QUEUED_THROTTLED_TIMEOUT_MINUTES = Number(process.env.QUEUED_THROTTLED_TIMEOUT_MINUTES) || 120;
const HIGH_PROGRESS_STALL_THRESHOLD = Number(process.env.HIGH_PROGRESS_STALL_THRESHOLD) || 0.95;

/** Create a RunwayDirectClient for a specific account.
 *  Resolves account from: (1) explicit accountId, (2) DB lookup by jobId, (3) default fallback.
 */
async function getClientForJob(accountId?: string, jobId?: string): Promise<RunwayDirectClient> {
  // Try explicit accountId first
  if (accountId) {
    const account = await prisma.runwayAccount.findUnique({ where: { id: accountId } });
    if (account) {
      return new RunwayDirectClient(account.token, Number(account.teamId), account.proxyUrl || undefined);
    }
  }
  // Fallback: look up accountId from the job record in DB
  if (jobId) {
    const job = await prisma.runwayJob.findUnique({ where: { id: jobId }, select: { accountId: true } });
    if (job?.accountId) {
      const account = await prisma.runwayAccount.findUnique({ where: { id: job.accountId } });
      if (account) {
        console.log(`[poll-worker] resolved account from DB for job ${jobId.slice(0,8)}: ${account.label}`);
        return new RunwayDirectClient(account.token, Number(account.teamId), account.proxyUrl || undefined);
      }
    }
  }
  console.warn(`[poll-worker] WARNING: using default account for job ${jobId?.slice(0,8) || '?'}`);
  return new RunwayDirectClient();
}

async function cancelRemoteBeforeRetry(accountId: string | undefined, jobId: string, remoteTaskId: string, reason: string): Promise<boolean> {
  try {
    const client = await getClientForJob(accountId, jobId);
    await client.cancelTask(remoteTaskId);
    console.warn(`[poll-worker] job ${jobId.slice(0,8)} cancelled remote ${remoteTaskId.slice(0,8)} before retry: ${reason}`);
    return true;
  } catch (err: any) {
    console.warn(`[poll-worker] job ${jobId.slice(0,8)} cancel remote ${remoteTaskId.slice(0,8)} failed: ${err.message || String(err)}, keep polling`);
    return false;
  }
}

const VIDEOS_DIR = '/root/runway/uploads/videos';
if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });

const CACHE_TIMEOUT = 60000; // 60s timeout for video download

async function cacheVideo(remoteUrl: string, jobId: string): Promise<string> {
  const filename = `video_${jobId.slice(0, 8)}_${Date.now()}.mp4`;
  const dest = path.join(VIDEOS_DIR, filename);
  try {
    console.log(`[poll-worker] caching video for job ${jobId.slice(0,8)}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CACHE_TIMEOUT);
    const res = await fetch(remoteUrl, { signal: controller.signal as any });
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const buf = await res.buffer();
    clearTimeout(timer);
    fs.writeFileSync(dest, buf);
    console.log(`[poll-worker] cached ${filename} (${Math.round(buf.length/1024)}KB)`);
    return `/img/videos/${filename}`;
  } catch (e: any) {
    console.warn(`[poll-worker] cache failed, using remote url: ${e.message}`);
    return remoteUrl;
  }
}

const INTERVAL_QUEUED     = Number(process.env.POLL_INTERVAL_QUEUED_MS) || 30000;
const INTERVAL_PROCESSING = Number(process.env.POLL_INTERVAL_PROCESSING_MS) || 10000;
const INTERVAL_QUEUED_MAX = Number(process.env.POLL_INTERVAL_QUEUED_MAX_MS) || 120000;
const INTERVAL_ERROR      = 30000;

function queuedPollDelay(startedAt?: Date | string | null): number {
  if (!startedAt) return INTERVAL_QUEUED;
  const queuedMinutes = Math.max(0, (Date.now() - new Date(startedAt).getTime()) / 60000);
  const step = Math.floor(queuedMinutes / 10);
  return Math.min(INTERVAL_QUEUED_MAX, INTERVAL_QUEUED + step * 15000);
}

new Worker('runway-poll', async (job: Job) => {
  const { jobId, remoteTaskId, accountId } = job.data;
  const dbJob = await prisma.runwayJob.findUnique({ where: { id: jobId } }) as any;
  if (!dbJob || ['completed', 'failed', 'cancelled', 'deleted'].includes(dbJob.status)) {
    if (accountId) await accountPool.release(accountId, jobId);
    return;
  }

  if (!['submitted', 'processing', 'queued'].includes(dbJob.status) || dbJob.remoteTaskId !== remoteTaskId) {
    console.log(
      `[poll-worker] stale poll ignored for job ${jobId.slice(0,8)} ` +
      `(dbStatus=${dbJob.status}, dbRemote=${dbJob.remoteTaskId ? String(dbJob.remoteTaskId).slice(0,8) : 'none'}, ` +
      `pollRemote=${String(remoteTaskId).slice(0,8)})`
    );
    return;
  }

  if (dbJob.resultUrl && dbJob.resultUrl.startsWith('/img/videos/')) {
    console.log(`[poll-worker] job ${jobId.slice(0,8)} already has cached video, marking completed`);
    await prisma.runwayJob.update({
      where: { id: jobId },
      data: { status: 'completed', finishedAt: dbJob.finishedAt || new Date() },
    });
    if (accountId) {
      await accountPool.release(accountId, jobId);
      await accountPool.incrementGenerated(accountId);
    }
    await triggerSubmit(humanSubmitDelay());
    return;
  }

  let result: any;
  try {
    const client = await getClientForJob(accountId, jobId);
    result = await client.getTask(remoteTaskId);
  } catch (err: any) {
    const errMsg = err.message || String(err);
    const is404 = errMsg.includes('404') || errMsg.includes('Could not find');
    const isTokenRevoked = errMsg.includes('401') && /revoked|invalid|expired|unauthorized/i.test(errMsg);

    if (is404 || isTokenRevoked) {
      const reason = is404 ? '系统任务不存在(404)，可能已被平台删除' : 'Token 已失效(401)，无法继续查询';
      console.warn(`[poll-worker] job ${jobId.slice(0,8)} ${is404 ? 'remote task 404' : 'token revoked'}, marking failed`);
      await prisma.runwayJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          errorMessage: reason,
          finishedAt: new Date(),
        },
      });
      if (accountId) {
        await accountPool.release(accountId, jobId);
        if (isTokenRevoked) {
          await accountPool.handleRiskError(accountId, errMsg);
        }
      }
      await triggerSubmit(humanSubmitDelay());
      return;
    }

    const startedAtMs = dbJob.startedAt ? new Date(dbJob.startedAt).getTime() : 0;
    const activeMinutes = startedAtMs ? (Date.now() - startedAtMs) / 60000 : 0;
    if (startedAtMs && activeMinutes > MAX_PROCESSING_MINUTES) {
      console.warn(
        `[poll-worker] job ${jobId.slice(0,8)} poll failed for ${Math.round(activeMinutes)}min, ` +
        `switching account: ${errMsg}`
      );
      let cancelled = false;
      if (accountId && remoteTaskId) {
        cancelled = await cancelRemoteBeforeRetry(accountId, jobId, remoteTaskId, 'poll timeout');
      }
      if (!cancelled) {
        console.warn(`[poll-worker] job ${jobId.slice(0,8)} remote cancel not confirmed after poll timeout; releasing local slot`);
      }
      await prisma.runwayJob.update({
        where: { id: jobId },
        data: {
          status: 'pending',
          remoteTaskId: null,
          errorMessage: `Poll timeout after ${Math.round(activeMinutes)} minutes, switching account`,
          startedAt: null,
          accountId: null,
        } as any,
      });
      if (accountId) {
        await accountPool.release(accountId, jobId);
        await connection.set(`job:avoid-account:${jobId}:${accountId}`, '1', 'EX', 600);
      }
      await triggerSubmit(humanSubmitDelay());
      return;
    }

    console.warn(`[poll-worker] getTask error for job ${jobId.slice(0,8)}: ${errMsg}, retry in ${INTERVAL_ERROR/1000}s`);
    await pollQueue.add('poll', {
      jobId, remoteTaskId, accountId,
    }, pollJobOptions(jobId, INTERVAL_ERROR));
    return;
  }

  if (result.status === 'completed') {
    const originalUrl = result.resultUrl || null;
    const localUrl = originalUrl ? await cacheVideo(originalUrl, jobId) : null;
    await prisma.runwayJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        resultUrl: localUrl || originalUrl,
        videoUrl: originalUrl,  // keep original URL for direct download
        thumbnailUrl: result.thumbnailUrl,
        finishedAt: new Date(),
        progress: 1,
        errorMessage: null,
      } as any,
    });
    console.log(`[poll-worker] job ${jobId.slice(0,8)} completed`);
    if (accountId) {
      await accountPool.release(accountId, jobId);
      await accountPool.incrementGenerated(accountId);
    }
    await triggerSubmit(humanSubmitDelay());
  } else if (result.status === 'cancelled') {
    // Remote task was cancelled by platform — auto-retry with different account
    const retryCount = (dbJob.retryCount || 0);
    if (retryCount < MAX_REMOTE_RETRIES) {
      console.warn(`[poll-worker] job ${jobId.slice(0,8)} cancelled by platform, switching account (retry ${retryCount + 1}/${MAX_REMOTE_RETRIES})`);
      await prisma.runwayJob.update({
        where: { id: jobId },
        data: {
          status: 'pending',
          remoteTaskId: null,
          errorMessage: `系统任务被取消，切换账号重试`,
          retryCount: retryCount + 1,
          startedAt: null,
          accountId: null,
        } as any,
      });
      if (accountId) {
        await accountPool.release(accountId, jobId);
        await accountPool.recordError(accountId, 'Task cancelled by platform');
        await connection.set(`job:avoid-account:${jobId}:${accountId}`, '1', 'EX', 600);
      }
      await triggerSubmit(humanSubmitDelay());
    } else {
      // Exhausted retries — mark as cancelled
      await prisma.runwayJob.update({
        where: { id: jobId },
        data: { status: 'cancelled', errorMessage: `系统任务被取消（已重试 ${retryCount} 次）`, finishedAt: new Date() },
      });
      if (accountId) {
        await accountPool.release(accountId, jobId);
      }
      console.log(`[poll-worker] job ${jobId.slice(0,8)} cancelled after ${retryCount} retries, giving up`);
      await triggerSubmit(humanSubmitDelay());
    }
  } else if (result.status === 'failed') {
    const retryCount = (dbJob.retryCount || 0);
    // Content moderation and risk control failures are not retryable
    const errMsg = result.errorMessage || '';
    const isNonRetryable = /moderation|SAFETY|risk control|SEXUALLY_EXPLICIT|VIOLENCE|prohibited/i.test(errMsg);
    if (!isNonRetryable && retryCount < MAX_REMOTE_RETRIES) {
      console.warn(`[poll-worker] job ${jobId.slice(0,8)} failed, auto-retry ${retryCount + 1}/${MAX_REMOTE_RETRIES}`);
      await prisma.runwayJob.update({
        where: { id: jobId },
        data: {
          status: 'pending',
          remoteTaskId: null,
          errorMessage: translateRunwayError(result.errorMessage),
          retryCount: retryCount + 1,
          startedAt: null,
          accountId: null,
        } as any,
      });
      if (accountId) {
        await accountPool.release(accountId, jobId);
        await accountPool.recordError(accountId, result.errorMessage || 'Task failed (auto-retry)');
        await connection.set(`job:avoid-account:${jobId}:${accountId}`, '1', 'EX', 600);
      }
    } else {
      await prisma.runwayJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          errorMessage: `${translateRunwayError(result.errorMessage)}（已重试 ${retryCount} 次，不再重试）`,
          finishedAt: new Date(),
        },
      });
      if (accountId) {
        await accountPool.release(accountId, jobId);
        await accountPool.handleRiskError(accountId, result.errorMessage || 'Task failed');
      }
      console.log(`[poll-worker] job ${jobId.slice(0,8)} failed after ${retryCount} retries, giving up`);
    }
    await triggerSubmit(humanSubmitDelay());
  } else {
    // Still processing — update progress only if changed
    if (result.progress !== undefined && result.progress !== (dbJob.progress || 0)) {
      await prisma.runwayJob.update({
        where: { id: jobId },
        data: { progress: result.progress } as any,
      }).catch(() => {});
    }

    // If remote task is queued/throttled, immediately requeue to try a different account
    if (result.status === 'queued' && dbJob.startedAt) {
      const queuedMinutes = (Date.now() - new Date(dbJob.startedAt).getTime()) / 60000;
      // Give queued/throttled remote tasks a long grace period before retrying.
      if (queuedMinutes > QUEUED_THROTTLED_TIMEOUT_MINUTES) {
        console.warn(`[poll-worker] job ${jobId.slice(0,8)} queued/throttled for ${Math.round(queuedMinutes)}min, switching account`);
        const cancelled = await cancelRemoteBeforeRetry(accountId, jobId, remoteTaskId, 'queued/throttled timeout');
        if (!cancelled) {
          await pollQueue.add('poll', {
            jobId, remoteTaskId, accountId,
          }, pollJobOptions(jobId, INTERVAL_ERROR));
          return;
        }
        await prisma.runwayJob.update({
          where: { id: jobId },
          data: {
            status: 'pending',
            remoteTaskId: null,
            errorMessage: `账号排队中，切换其他账号重试`,
            startedAt: null,
            accountId: null,
          } as any,
        });
        if (accountId) {
          await accountPool.release(accountId, jobId);
          await connection.set(`job:avoid-account:${jobId}:${accountId}`, '1', 'EX', 600);
        }
        await triggerSubmit(humanSubmitDelay());
        return;
      }
    }

    // Stuck zero-progress recovery: switch account only after the configured grace period.
    if (result.status !== 'queued' && dbJob.startedAt && (result.progress || 0) === 0) {
      const stuckMinutes = (Date.now() - new Date(dbJob.startedAt).getTime()) / 60000;
      if (stuckMinutes > ZERO_PROGRESS_TIMEOUT_MINUTES) {
        console.warn(`[poll-worker] job ${jobId.slice(0,8)} processing ${Math.round(stuckMinutes)}min with progress=0, switching account`);
        const cancelled = await cancelRemoteBeforeRetry(accountId, jobId, remoteTaskId, 'processing zero progress');
        if (!cancelled) {
          await pollQueue.add('poll', {
            jobId, remoteTaskId, accountId,
          }, pollJobOptions(jobId, INTERVAL_ERROR));
          return;
        }
        await prisma.runwayJob.update({
          where: { id: jobId },
          data: {
            status: 'pending',
            remoteTaskId: null,
            errorMessage: `处理中无进度，切换账号重试`,
            startedAt: null,
            accountId: null,
          } as any,
        });
        if (accountId) {
          await accountPool.release(accountId, jobId);
          await connection.set(`job:avoid-account:${jobId}:${accountId}`, '1', 'EX', 600);
        }
        await triggerSubmit(humanSubmitDelay());
        return;
      }
    }

    // Tail-end stalls: Runway can sit at 95-99% for a long time without finishing.
    // updatedAt tracks the last progress change here, so stale high progress means retry.
    if (result.status !== 'queued' && dbJob.updatedAt && (result.progress || 0) >= HIGH_PROGRESS_STALL_THRESHOLD) {
      const staleMinutes = (Date.now() - new Date(dbJob.updatedAt).getTime()) / 60000;
      if (staleMinutes > PROGRESS_STALL_MINUTES) {
        console.warn(`[poll-worker] job ${jobId.slice(0,8)} progress stalled at ${result.progress} for ${Math.round(staleMinutes)}min, retrying`);
        const cancelled = await cancelRemoteBeforeRetry(accountId, jobId, remoteTaskId, 'high progress stalled');
        if (!cancelled) {
          await pollQueue.add('poll', {
            jobId, remoteTaskId, accountId,
          }, pollJobOptions(jobId, INTERVAL_ERROR));
          return;
        }
        await prisma.runwayJob.update({
          where: { id: jobId },
          data: {
            status: 'pending',
            remoteTaskId: null,
            errorMessage: `进度长时间未变化，已重新排队重试`,
            startedAt: null,
            accountId: null,
          } as any,
        });
        if (accountId) {
          await accountPool.release(accountId, jobId);
        }
        await triggerSubmit(humanSubmitDelay());
        return;
      }
    }

    // Processing timeout.
    if (result.status !== 'queued' && dbJob.startedAt) {
      const processingMinutes = (Date.now() - new Date(dbJob.startedAt).getTime()) / 60000;
      if (processingMinutes > MAX_PROCESSING_MINUTES) {
        console.warn(`[poll-worker] job ${jobId.slice(0,8)} generation timeout (${Math.round(processingMinutes)}min), switching account`);
        const cancelled = await cancelRemoteBeforeRetry(accountId, jobId, remoteTaskId, 'processing timeout');
        if (!cancelled) {
          await pollQueue.add('poll', {
            jobId, remoteTaskId, accountId,
          }, pollJobOptions(jobId, INTERVAL_ERROR));
          return;
        }
        await prisma.runwayJob.update({
          where: { id: jobId },
          data: {
            status: 'pending',
            remoteTaskId: null,
            errorMessage: `生成超时(${Math.round(processingMinutes)}分钟)，切换账号重试`,
            startedAt: null,
            accountId: null,
          } as any,
        });
        if (accountId) {
          await accountPool.release(accountId, jobId);
          await connection.set(`job:avoid-account:${jobId}:${accountId}`, '1', 'EX', 600);
        }
        await triggerSubmit(humanSubmitDelay());
        return;
      }
    }

    // Re-check DB status before re-queuing (user may have cancelled during API call)
    const freshJob = await prisma.runwayJob.findUnique({ where: { id: jobId }, select: { status: true } });
    if (!freshJob || ['completed', 'failed', 'cancelled', 'deleted'].includes(freshJob.status)) {
      console.log(`[poll-worker] job ${jobId.slice(0,8)} status changed to ${freshJob?.status || 'deleted'}, stopping poll`);
      if (accountId) await accountPool.release(accountId, jobId);
      if (freshJob?.status === 'cancelled') await triggerSubmit(humanSubmitDelay());
      return;
    }

    // Re-acquire slot when THROTTLED job starts actually processing (soft: allow temporary over-cap)
    if (result.status !== 'queued' && accountId) {
      const slotReleasedKey = `poll:slot-released:${jobId}`;
      const wasReleased = await connection.get(slotReleasedKey);
      if (wasReleased) {
        const concKey = `account:concurrency:${accountId}`;
        const cur = await connection.incr(concKey);
        await connection.expire(concKey, 900);
        await connection.del(slotReleasedKey);
        await connection.del(`account:released:${accountId}:${jobId}`);
        await prisma.runwayJob.update({
          where: { id: jobId },
          data: { status: 'processing', errorMessage: null } as any,
        }).catch(() => {});
        console.log(`[poll-worker] job ${jobId.slice(0,8)} RUNNING again, re-acquired slot soft (${cur})`);
      }
    }

    // THROTTLED/queued still counts against Runway platform concurrency.
    // Keep the local slot occupied; otherwise the submitter creates extra remote tasks
    // that immediately become platform-active queue blockers.
    if (result.status === 'queued' && accountId) {
      await connection.del(`poll:slot-released:${jobId}`);
      await connection.del(`account:released:${accountId}:${jobId}`);
      await prisma.runwayJob.update({
        where: { id: jobId },
        data: { status: 'processing', errorMessage: '平台排队中，继续等待' } as any,
      }).catch(() => {});
      console.log(`[poll-worker] job ${jobId.slice(0,8)} THROTTLED, keeping account slot occupied`);
    }

    const delay = result.status === 'queued' ? queuedPollDelay(dbJob.startedAt) : INTERVAL_PROCESSING;
    await pollQueue.add('poll', {
      jobId, remoteTaskId, accountId,
    }, pollJobOptions(jobId, delay));
  }
}, { connection, concurrency: 1 });

console.log('[poll-worker] listening on runway-poll (single-trigger mode)');

// ============================================================
// Stuck job recovery: periodically re-enqueue poll for jobs
// stuck in processing/submitted/queued that have no active poll
// ============================================================
const RECOVERY_INTERVAL = 5 * 60 * 1000; // 5 minutes
const STUCK_THRESHOLD_MINUTES = 15;

async function recoverStuckJobs() {
  try {
    const stuckJobs = await prisma.$queryRawUnsafe(`
      SELECT id, remote_task_id, account_id, status, started_at
      FROM runway_jobs
      WHERE status IN ('processing', 'submitted', 'queued')
        AND remote_task_id IS NOT NULL
        AND updated_at < NOW() - INTERVAL '${STUCK_THRESHOLD_MINUTES} minutes'
      ORDER BY created_at ASC
      LIMIT 20
    `) as any[];

    if (stuckJobs.length === 0) return;

    console.log(`[recovery] found ${stuckJobs.length} potentially stuck jobs`);

    for (const job of stuckJobs) {
      // Check if there's already an active/delayed poll for this job
      const existingKey = `recovery:poll-active:${job.id}`;
      const exists = await connection.get(existingKey);
      if (exists) continue;

      console.log(`[recovery] re-enqueueing poll for job ${job.id.slice(0, 8)} (status=${job.status})`);

      // Mark as active to avoid duplicate recovery
      await connection.set(existingKey, '1', 'EX', 600);

      await pollQueue.add('poll', {
        jobId: job.id,
        remoteTaskId: job.remote_task_id,
        accountId: job.account_id,
      }, {
        ...pollJobOptions(job.id, 1000, `recovery-${Date.now()}`),
      });

      // Touch updated_at so it doesn't get picked up again immediately
      await prisma.runwayJob.update({
        where: { id: job.id },
        data: { updatedAt: new Date() } as any,
      }).catch(() => {});
    }
  } catch (err: any) {
    console.error(`[recovery] error: ${err.message}`);
  }
}

setInterval(recoverStuckJobs, RECOVERY_INTERVAL);
// Run once on startup after a short delay
setTimeout(recoverStuckJobs, 30000);
console.log(`[recovery] stuck job recovery enabled (every ${RECOVERY_INTERVAL/1000}s, threshold ${STUCK_THRESHOLD_MINUTES}min)`);
