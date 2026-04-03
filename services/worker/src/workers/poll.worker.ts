import { Worker, Job, Queue } from 'bullmq';
import fs from 'fs';
import path from 'path';
import IORedis from 'ioredis';
import fetch from 'node-fetch';
import { PrismaClient } from '@prisma/client';
import { RunwayDirectClient } from '../services/runway.direct';

const prisma = new PrismaClient();
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const pollQueue = new Queue('runway-poll', { connection });
const submitQueue = new Queue('runway-submit', { connection });
const client = new RunwayDirectClient();

// Max auto-retries when remote task fails (prevents infinite loop)
const MAX_REMOTE_RETRIES = 3;
// Max BullMQ attempts for submit queue jobs created by auto-retry
const MAX_SUBMIT_ATTEMPTS = 60;

async function promoteNextJob() {
  try {
    const delayed = await submitQueue.getDelayed();
    if (delayed.length > 0) {
      await delayed[0].promote();
      console.log(`[poll-worker] promoted next job (${delayed.length} were delayed)`);
    }
  } catch {}
}

const VIDEOS_DIR = '/root/runway/uploads/videos';
if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });

async function cacheVideo(remoteUrl: string, jobId: string): Promise<string> {
  const filename = `video_${jobId.slice(0, 8)}_${Date.now()}.mp4`;
  const dest = path.join(VIDEOS_DIR, filename);
  try {
    console.log(`[poll-worker] caching video for job ${jobId.slice(0,8)}`);
    const res = await fetch(remoteUrl);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const buf = await res.buffer();
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

new Worker('runway-poll', async (job: Job) => {
  const { jobId, remoteTaskId } = job.data;
  const dbJob = await prisma.runwayJob.findUnique({ where: { id: jobId } });
  if (!dbJob || ['completed', 'failed', 'cancelled'].includes(dbJob.status)) return;

  if (dbJob.resultUrl && dbJob.resultUrl.startsWith('/img/videos/')) {
    console.log(`[poll-worker] job ${jobId.slice(0,8)} already has cached video, marking completed`);
    await prisma.runwayJob.update({
      where: { id: jobId },
      data: { status: 'completed', finishedAt: dbJob.finishedAt || new Date() },
    });
    await promoteNextJob();
    return;
  }

  const result = await client.getTask(remoteTaskId);

  if (result.status === 'completed') {
    const localUrl = result.resultUrl ? await cacheVideo(result.resultUrl, jobId) : null;
    await prisma.runwayJob.update({
      where: { id: jobId },
      data: { status: 'completed', resultUrl: localUrl || result.resultUrl, thumbnailUrl: result.thumbnailUrl, finishedAt: new Date() },
    });
    await promoteNextJob();
  } else if (result.status === 'failed' || result.status === 'cancelled') {
    const retryCount = (dbJob.retryCount || 0);

    if (result.status === 'failed' && retryCount < MAX_REMOTE_RETRIES) {
      // Auto-retry: increment retryCount, re-queue for submit
      await prisma.runwayJob.update({
        where: { id: jobId },
        data: { status: 'pending', errorMessage: result.errorMessage, retryCount: retryCount + 1 },
      });
      const existing = await submitQueue.getJob(`submit-${jobId}`);
      if (existing) await existing.remove().catch(() => {});
      await submitQueue.add('submit', { jobId, duration: (dbJob as any).duration || 5, resolution: job.data.resolution, quality: job.data.quality, cfgScale: job.data.cfgScale, sound: job.data.sound, videoUrl: job.data.videoUrl }, {
        jobId: `submit-${jobId}`, delay: 5000, attempts: MAX_SUBMIT_ATTEMPTS, backoff: { type: 'custom' },
      });
      console.log(`[poll-worker] auto-retry #${retryCount + 1}/${MAX_REMOTE_RETRIES} for job ${jobId.slice(0,8)}`);
    } else {
      // Max retries reached or cancelled — mark as final state
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
    await promoteNextJob();
  } else {
    const delay = result.status === 'queued' ? INTERVAL_QUEUED : INTERVAL_PROCESSING;
    await pollQueue.add('poll', { jobId, remoteTaskId, duration: job.data.duration, resolution: job.data.resolution, quality: job.data.quality, cfgScale: job.data.cfgScale, sound: job.data.sound, videoUrl: job.data.videoUrl }, { jobId: `poll-${jobId}-${Date.now()}`, delay });
  }
}, { connection, concurrency: 1 });

console.log('[poll-worker] listening on runway-poll (direct mode)');

setInterval(async () => {
  try {
    const delayed = await submitQueue.getDelayed();
    if (delayed.length === 0) return;
    const active = await submitQueue.getActive();
    const waiting = await submitQueue.getWaiting();
    if (active.length === 0 && waiting.length === 0) {
      await delayed[0].promote();
      console.log('[poll-worker] heartbeat: promoted stuck delayed job');
    }
  } catch {}
}, 30000);
