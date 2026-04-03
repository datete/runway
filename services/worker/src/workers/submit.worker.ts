import { Worker, Job } from "bullmq";
import { RunwayDirectClient } from "../services/runway.direct";
import { prisma, redis as connection, accountPool } from "../services/shared";

new Worker("runway-submit", async (job: Job) => {
  const { jobId, duration, resolution, quality, cfgScale, sound, videoUrl } = job.data;
  console.log(`[submit-worker] attempt=${job.attemptsMade+1} jobId=${jobId.slice(0,8)}`);

  const dbJob = await prisma.runwayJob.findUnique({ where: { id: jobId } });
  if (!dbJob || ["cancelled", "completed", "processing"].includes(dbJob.status)) {
    console.log(`[submit-worker] job ${jobId.slice(0,8)} cancelled/missing, skip`);
    return;
  }

  // --- Per-user concurrency check (before acquiring account) ---
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
          id: { not: jobId }, // exclude self
        },
      });
      if (activeCount >= user.maxConcurrency) {
        console.log(`[submit-worker] user ${dbJob.userId.slice(0,8)} concurrency full (${activeCount}/${user.maxConcurrency}), retry later`);
        await prisma.runwayJob.update({ where: { id: jobId }, data: { status: "queued" } });
        throw Object.assign(new Error("USER_CONCURRENCY"), { name: "USER_CONCURRENCY" });
      }
    }
  }

  // Parse reference image URLs
  let imageUrls: string[] | undefined;
  const raw = (dbJob as any).referenceImages;
  if (raw) {
    try { imageUrls = JSON.parse(raw); } catch {}
  }

  // Use params from job.data first, fallback to DB (for legacy jobs before param persistence)
  const finalResolution = resolution ?? (dbJob as any).resolution;
  const finalQuality = quality ?? (dbJob as any).quality;
  const finalCfgScale = cfgScale ?? (dbJob as any).cfgScale;
  const finalSound = sound ?? (dbJob as any).sound;
  const finalVideoUrl = videoUrl ?? (dbJob as any).videoUrl;

  // Acquire an account from the pool (replaces TokenPool)
  const account = await accountPool.acquire();
  if (!account) {
    console.warn(`[submit-worker] all accounts in cooldown or at max concurrency, will retry`);
    await prisma.runwayJob.update({ where: { id: jobId }, data: { status: "pending" } });
    throw Object.assign(new Error("COOLDOWN"), { name: "COOLDOWN" });
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
      duration:    duration || 5,
      exploreMode: dbJob.exploreMode ?? true,
      modelName:   "kling_3_0_standard",
      resolution:  finalResolution,
      quality:     finalQuality,
      cfgScale:    finalCfgScale,
      sound:       finalSound,
      videoUrl:    finalVideoUrl,
    });

    await prisma.runwayJob.update({
      where: { id: jobId },
      data: { remoteTaskId, status: "processing" },
    });
    console.log(`[submit-worker] jobId=${jobId.slice(0,8)} remoteTaskId=${remoteTaskId} account=${account.label}`);

    const { Queue } = await import("bullmq");
    const pollQueue = new Queue("runway-poll", { connection });
    await pollQueue.add("poll", {
      jobId, remoteTaskId,
      accountId: account.id,
    }, { jobId: `poll-${jobId}`, delay: 15000 });

    // NOTE: concurrency slot is NOT released here — poll worker releases on completion/failure

  } catch (err: any) {
    const msg = err.message || String(err);
    if (msg === "COOLDOWN" || msg === "CONCURRENCY_FULL" || msg === "USER_CONCURRENCY") throw err;
    console.error(`[submit-worker] jobId=${jobId.slice(0,8)} error: ${msg}`);

    // Release the concurrency slot on error
    await accountPool.release(account.id, jobId);

    if (msg === "RATE_LIMITED") {
      await accountPool.setCooldown(account.id);
      await accountPool.recordError(account.id, "429 Rate Limited");
      await prisma.runwayJob.update({ where: { id: jobId }, data: { status: "pending" } });
      throw Object.assign(new Error("COOLDOWN"), { name: "COOLDOWN" });
    }

    await accountPool.recordError(account.id, msg);
    await prisma.runwayJob.update({
      where: { id: jobId },
      data: { status: "failed", errorMessage: msg, finishedAt: new Date() },
    });
  }
}, {
  connection,
  concurrency: Number(process.env.SUBMIT_CONCURRENCY) || 1,
  settings: {
    backoffStrategy: (_attempts: number, _type: string, err: Error) => {
      if (err?.message === "COOLDOWN") return 70000;
      if (err?.message === "USER_CONCURRENCY") return 20000; // check again in 20s
      return 30000; // CONCURRENCY_FULL or default
    },
  },
});

console.log("[submit-worker] listening on runway-submit (multi-account mode)");
