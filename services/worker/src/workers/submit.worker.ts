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
  } catch {}
}

type SubmitResult = "submitted" | "no_pending" | "concurrency_full" | "rate_limited" | "job_failed";

/** Try to submit one pending job. Returns status string. */
async function trySubmitOne(): Promise<SubmitResult> {
  const dbJob = await prisma.runwayJob.findFirst({
    where: { status: { in: ["pending", "queued"] } },
    orderBy: { createdAt: "asc" },
  }) as any;

  if (!dbJob) return "no_pending";

  const jobId: string = dbJob.id;
  console.log(`[submit-worker] FIFO pick jobId=${jobId.slice(0,8)} created=${dbJob.createdAt.toISOString()}`);

  // --- Per-user concurrency check ---
  if (dbJob.userId) {
    const user = await prisma.user.findUnique({
      where: { id: dbJob.userId },
      select: { maxConcurrency: true },
    });
    if (user && user.maxConcurrency !== null) {
      const activeCount = await prisma.runwayJob.count({
        where: {
          userId: dbJob.userId,
          status: { in: ["submitted", "processing"] },
          id: { not: jobId },
        },
      });
      if (activeCount >= user.maxConcurrency) {
        console.log(`[submit-worker] user concurrency full (${activeCount}/${user.maxConcurrency})`);
        await prisma.runwayJob.update({ where: { id: jobId }, data: { status: "queued" } });
        return "concurrency_full";
      }
    }
  }

  // Parse reference image URLs
  let imageUrls: string[] | undefined;
  if (dbJob.referenceImages) {
    try { imageUrls = JSON.parse(dbJob.referenceImages); } catch {}
  }

  // Acquire an account — no cooldown, just concurrency check
  const account = await accountPool.acquire();
  if (!account) {
    console.log(`[submit-worker] account concurrency full`);
    return "concurrency_full";
  }

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
      modelName:   "kling_3_0_standard",
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

    await pollQueue.add("poll", {
      jobId, remoteTaskId,
      accountId: account.id,
    }, { jobId: `poll-${jobId}`, delay: 15000 });

    return "submitted";

  } catch (err: any) {
    const msg = err.message || String(err);
    console.error(`[submit-worker] jobId=${jobId.slice(0,8)} error: ${msg.slice(0, 120)}`);

    if (msg === "RATE_LIMITED") {
      // Release without jobId guard — same job will be retried
      await accountPool.release(account.id);
      await accountPool.recordError(account.id, "429 Rate Limited");
      await prisma.runwayJob.update({ where: { id: jobId }, data: { status: "pending" } });
      return "rate_limited";
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
      console.log(`[submit-worker] rate limited, will retry in 30s`);
      await triggerSubmit(30000);
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
  } catch {}
}, 30000);

console.log("[submit-worker] listening (FIFO from DB, 30s periodic check)");
