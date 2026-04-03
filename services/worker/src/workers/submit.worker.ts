import { Worker, Job, Queue } from "bullmq";
import { RunwayDirectClient } from "../services/runway.direct";
import { prisma, redis as connection, accountPool } from "../services/shared";

const pollQueue = new Queue("runway-poll", { connection });
const submitQueue = new Queue("runway-submit", { connection });

/**
 * Trigger submission by adding a one-shot job with unique ID.
 * Safe to call from anywhere — inside worker handler, poll worker, API, etc.
 */
export async function triggerSubmit(delay = 0): Promise<void> {
  try {
    await submitQueue.add("submit-trigger", {}, {
      jobId: `trig-${Date.now()}`,
      delay,
      removeOnComplete: 10,
      removeOnFail: 10,
    });
  } catch (e: any) { console.warn('[submit] triggerSubmit error:', e.message); }
}

type SubmitResult = "submitted" | "no_pending" | "concurrency_full" | "rate_limited" | "network_error" | "job_failed";

/** Try to submit one pending job. Returns status string. */
async function trySubmitOne(): Promise<SubmitResult> {
  // Fetch up to 10 pending jobs to avoid head-of-line blocking across users
  const pendingJobs = await prisma.runwayJob.findMany({
    where: { status: { in: ["pending", "queued"] } },
    orderBy: { createdAt: "asc" },
    take: 10,
  }) as any[];

  if (pendingJobs.length === 0) return "no_pending";

  let dbJob: any = null;

  for (const candidate of pendingJobs) {
    if (candidate.userId) {
      const user = await prisma.user.findUnique({
        where: { id: candidate.userId },
        select: { maxConcurrency: true },
      });
      if (user && user.maxConcurrency !== null) {
        const activeCount = await prisma.runwayJob.count({
          where: {
            userId: candidate.userId,
            status: { in: ["submitted", "processing"] },
            id: { not: candidate.id },
          },
        });
        if (activeCount >= user.maxConcurrency) {
          console.log(`[submit-worker] user ${candidate.userId} concurrency full (${activeCount}/${user.maxConcurrency}), skipping job ${candidate.id.slice(0,8)}`);
          // Mark as queued so it's not re-picked immediately
          await prisma.runwayJob.update({ where: { id: candidate.id }, data: { status: "queued" } });
          continue; // try next job from a different user
        }
      }
    }
    dbJob = candidate;
    break;
  }

  if (!dbJob) return "concurrency_full"; // all candidates blocked by user concurrency

  const jobId: string = dbJob.id;
  console.log(`[submit-worker] FIFO pick jobId=${jobId.slice(0,8)} created=${dbJob.createdAt.toISOString()}`);

  // Parse reference image URLs
  let imageUrls: string[] | undefined;
  if (dbJob.referenceImages) {
    try { imageUrls = JSON.parse(dbJob.referenceImages); } catch (e: any) { console.warn('[submit] referenceImages parse error:', e.message); }
  }

  // Acquire an account — no cooldown, just concurrency check
  const account = await accountPool.acquire();
  if (!account) {
    console.log(`[submit-worker] account concurrency full`);
    return "concurrency_full";
  }

  // Clear stale release guard for this account+job (prevents release being blocked on retry/re-submit)
  await connection.del(`account:released:${account.id}:${jobId}`);

  const client = new RunwayDirectClient(account.token, Number(account.teamId), account.proxyUrl || undefined);

  try {
    await prisma.runwayJob.update({
      where: { id: jobId },
      data: { status: "submitted", startedAt: new Date(), usedToken: account.tokenShort, accountId: account.id } as any,
    });

    const { remoteTaskId } = await client.createTask({
      prompt:      dbJob.prompt,
      mode:        dbJob.mode as any,
      imageUrl:    dbJob.imageUrl || undefined,
      imageUrls,
      duration:    dbJob.duration || 5,
      exploreMode: dbJob.exploreMode ?? true,
      modelName:   dbJob.quality === "pro" ? "kling_3_0_pro" : "kling_3_0_standard",
      resolution:  dbJob.resolution,
      quality:     dbJob.quality,
      cfgScale:    dbJob.cfgScale,
      sound:       dbJob.sound,
      videoUrl:    dbJob.videoUrl,
    });

    await prisma.runwayJob.update({
      where: { id: jobId },
      data: { remoteTaskId, status: "processing" },
    });
    console.log(`[submit-worker] jobId=${jobId.slice(0,8)} -> processing, remote=${remoteTaskId.slice(0,8)}, account=${account.label}`);

    // Retry pollQueue.add up to 3 times — do NOT let failure overwrite DB status
    let pollAdded = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await pollQueue.add("poll", {
          jobId, remoteTaskId,
          accountId: account.id,
        }, { jobId: `poll-${jobId}-${Date.now()}`, delay: 15000 });
        pollAdded = true;
        break;
      } catch (pollErr: any) {
        console.error(`[submit-worker] pollQueue.add attempt ${attempt}/3 failed: ${pollErr.message}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 1000));
      }
    }
    if (!pollAdded) {
      // Leave DB in "processing" — startup recovery will pick it up
      console.error(`[submit-worker] pollQueue.add failed after 3 retries, leaving job ${jobId.slice(0,8)} in processing for recovery`);
      // Do NOT release concurrency slot — recovery will handle it
      return "submitted";
    }

    return "submitted";

  } catch (err: any) {
    const msg = err.message || String(err);
    console.error(`[submit-worker] jobId=${jobId.slice(0,8)} error: ${msg.slice(0, 120)}`);

    const isNetworkError = /socket hang up|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|EAI_AGAIN|network|fetch failed/i.test(msg);

    if (msg === "RATE_LIMITED") {
      // Release without jobId guard — same job will be retried
      await accountPool.release(account.id);
      await accountPool.recordError(account.id, "429 Rate Limited");
      await prisma.runwayJob.update({ where: { id: jobId }, data: { status: "pending" } });
      return "rate_limited";
    }

    if (isNetworkError) {
      // Network error — release slot, keep job pending, retry after delay
      await accountPool.release(account.id);
      await accountPool.recordError(account.id, msg.slice(0, 200));
      await prisma.runwayJob.update({ where: { id: jobId }, data: { status: "pending", errorMessage: '网络错误(将重试)' } });
      console.log(`[submit-worker] network error, will retry in 10s`);
      return "network_error";
    }

    await accountPool.release(account.id, jobId);
    await accountPool.recordError(account.id, msg);
    await prisma.runwayJob.update({
      where: { id: jobId },
      data: { status: "failed", errorMessage: msg.slice(0, 500), finishedAt: new Date() },
    });
    return "job_failed"; // job failed but slot freed, can try next
  }
}

// Worker: each trigger job tries to fill available slots
new Worker("runway-submit", async (job: Job) => {
  const result = await trySubmitOne();

  switch (result) {
    case "submitted":
    case "job_failed":
      // Success or failed-and-freed — try to fill more slots immediately
      await triggerSubmit(1000);
      break;
    case "rate_limited":
      // 429 — wait 30s before trying again
      await triggerSubmit(30000);
      break;
    case "network_error":
      // Network error — retry after 10s
      await triggerSubmit(10000);
      break;
    case "concurrency_full":
      // All slots occupied — poll worker will trigger when slot frees
      // Periodic check (30s) as safety net
      break;
    case "no_pending":
      // Nothing to do
      break;
  }
}, {
  connection,
  concurrency: Number(process.env.SUBMIT_CONCURRENCY) || 1,
});

// Periodic safety net: check for pending jobs every 30s
setInterval(async () => {
  try {
    const pendingCount = await prisma.runwayJob.count({
      where: { status: { in: ["pending", "queued"] } },
    });
    if (pendingCount > 0) {
      await triggerSubmit();
    }
  } catch (e: any) { console.warn('[submit] periodic check error:', e.message); }
}, 30000);

console.log("[submit-worker] listening (FIFO from DB, 30s periodic check)");
