import { Worker, Job, Queue } from 'bullmq';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { RunwayDirectClient } from '../services/runway.direct';
import { prisma, redis as connection, accountPool } from '../services/shared';
import { triggerSubmit } from './submit.worker';

const pollQueue = new Queue('runway-poll', { connection });

// Max auto-retries when remote task fails (prevents infinite loop)
const MAX_REMOTE_RETRIES = 3;

/** Create a RunwayDirectClient for a specific account */
async function getClientForJob(accountId?: string): Promise<RunwayDirectClient> {
  if (accountId) {
    const account = await prisma.runwayAccount.findUnique({ where: { id: accountId } });
    if (account) {
      return new RunwayDirectClient(account.token, Number(account.teamId), account.proxyUrl || undefined);
    }
  }
  return new RunwayDirectClient();
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

const INTERVAL_QUEUED     = Number(process.env.POLL_INTERVAL_QUEUED_MS) || 20000;
const INTERVAL_PROCESSING = Number(process.env.POLL_INTERVAL_PROCESSING_MS) || 10000;
const INTERVAL_ERROR      = 30000;

new Worker('runway-poll', async (job: Job) => {
  const { jobId, remoteTaskId, accountId } = job.data;
  const dbJob = await prisma.runwayJob.findUnique({ where: { id: jobId } }) as any;
  if (!dbJob || ['completed', 'failed', 'cancelled'].includes(dbJob.status)) {
    if (accountId) await accountPool.release(accountId, jobId);
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
    await triggerSubmit();
    return;
  }

  let result: any;
  try {
    const client = await getClientForJob(accountId);
    result = await client.getTask(remoteTaskId);
  } catch (err: any) {
    console.warn(`[poll-worker] getTask error for job ${jobId.slice(0,8)}: ${err.message}, retry in ${INTERVAL_ERROR/1000}s`);
    await pollQueue.add('poll', {
      jobId, remoteTaskId, accountId,
    }, { jobId: `poll-${jobId}-${Date.now()}`, delay: INTERVAL_ERROR });
    return;
  }

  if (result.status === 'completed') {
    const localUrl = result.resultUrl ? await cacheVideo(result.resultUrl, jobId) : null;
    await prisma.runwayJob.update({
      where: { id: jobId },
      data: { status: 'completed', resultUrl: localUrl || result.resultUrl, thumbnailUrl: result.thumbnailUrl, finishedAt: new Date(), progress: 1, errorMessage: null } as any,
    });
    if (accountId) {
      await accountPool.release(accountId, jobId);
      await accountPool.incrementGenerated(accountId);
    }
    console.log(`[poll-worker] job ${jobId.slice(0,8)} completed`);
    // Slot freed — trigger next submission immediately
    await triggerSubmit();
  } else if (result.status === 'failed' || result.status === 'cancelled') {
    if (accountId) {
      await accountPool.release(accountId, jobId);
      await accountPool.recordError(accountId, result.errorMessage || 'Task failed');
    }

    const retryCount = (dbJob.retryCount || 0);

    if (result.status === 'failed' && retryCount < MAX_REMOTE_RETRIES) {
      await prisma.runwayJob.update({
        where: { id: jobId },
        data: { status: 'pending', errorMessage: result.errorMessage, retryCount: retryCount + 1 },
      });
      console.log(`[poll-worker] auto-retry #${retryCount + 1}/${MAX_REMOTE_RETRIES} for job ${jobId.slice(0,8)}`);
    } else {
      const finalStatus = result.status === 'failed' ? 'failed' : 'cancelled';
      const errMsg = retryCount >= MAX_REMOTE_RETRIES
        ? `${result.errorMessage || '远程任务失败'}（已重试 ${retryCount} 次，不再重试）`
        : (result.errorMessage || undefined);
      await prisma.runwayJob.update({
        where: { id: jobId },
        data: { status: finalStatus, errorMessage: errMsg, finishedAt: new Date() },
      });
      console.log(`[poll-worker] job ${jobId.slice(0,8)} final ${finalStatus} after ${retryCount} retries`);
    }
    // Slot freed — trigger next submission
    await triggerSubmit();
  } else {
    // Still processing — update progress and re-queue poll
    if (result.progress !== undefined) {
      await prisma.runwayJob.update({
        where: { id: jobId },
        data: { progress: result.progress } as any,
      }).catch(() => {});
    }
    const delay = result.status === 'queued' ? INTERVAL_QUEUED : INTERVAL_PROCESSING;
    await pollQueue.add('poll', {
      jobId, remoteTaskId, accountId,
    }, { jobId: `poll-${jobId}-${Date.now()}`, delay });
  }
}, { connection, concurrency: 1 });

console.log('[poll-worker] listening on runway-poll (single-trigger mode)');
