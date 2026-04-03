import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { RunwayDirectClient } from "../services/runway.direct";
import { TokenPool } from "../services/token-pool";

const prisma = new PrismaClient();
const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});
const tokenPool = new TokenPool(connection);

// Max BullMQ attempts for transient issues (cooldown / concurrency full)
const MAX_QUEUE_ATTEMPTS = 60;

new Worker("runway-submit", async (job: Job) => {
  const { jobId, duration, resolution, quality, cfgScale, sound, videoUrl } = job.data;
  console.log(`[submit-worker] attempt=${job.attemptsMade+1}/${MAX_QUEUE_ATTEMPTS} jobId=${jobId.slice(0,8)}`);

  const dbJob = await prisma.runwayJob.findUnique({ where: { id: jobId } });
  if (!dbJob || ["cancelled", "completed", "processing"].includes(dbJob.status)) {
    console.log(`[submit-worker] job ${jobId.slice(0,8)} cancelled/missing, skip`);
    return;
  }

  // Safety: if BullMQ attempts exceed limit, mark as failed
  if (job.attemptsMade >= MAX_QUEUE_ATTEMPTS) {
    console.error(`[submit-worker] jobId=${jobId.slice(0,8)} exceeded ${MAX_QUEUE_ATTEMPTS} queue attempts, marking failed`);
    await prisma.runwayJob.update({
      where: { id: jobId },
      data: { status: "failed", errorMessage: "排队超时：超过最大重试次数", finishedAt: new Date() },
    });
    return;
  }

  // --- Per-user concurrency check (before acquiring token) ---
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

  // Token cooldown check
  const tok = await tokenPool.acquire();
  if (!tok) {
    console.warn(`[submit-worker] all tokens in cooldown, will retry in 70s`);
    await prisma.runwayJob.update({ where: { id: jobId }, data: { status: "pending" } });
    throw Object.assign(new Error("COOLDOWN"), { name: "COOLDOWN" });
  }
  const client = new RunwayDirectClient(tok.token, tok.teamId);

  // Global Runway API concurrency check
  const activeTasks = await client.getActiveConcurrency();
  if (activeTasks >= 2) {
    console.log(`[submit-worker] concurrency full (${activeTasks}/2), will retry in 30s`);
    await prisma.runwayJob.update({ where: { id: jobId }, data: { status: "pending" } });
    throw Object.assign(new Error("CONCURRENCY_FULL"), { name: "CONCURRENCY_FULL" });
  }

  try {
    await prisma.runwayJob.update({
      where: { id: jobId },
      data: { status: "submitted", startedAt: new Date(), usedToken: tok.id } as any,
    });

    const { remoteTaskId } = await client.createTask({
      prompt:      dbJob.prompt,
      mode:        dbJob.mode as any,
      imageUrl:    dbJob.imageUrl || undefined,
      imageUrls,
      duration:    duration || 5,
      exploreMode: dbJob.exploreMode ?? true,
      modelName:   "kling_3_0_standard",
      resolution,
      quality,
      cfgScale,
      sound,
      videoUrl,
    });

    await prisma.runwayJob.update({
      where: { id: jobId },
      data: { remoteTaskId, status: "processing" },
    });
    console.log(`[submit-worker] jobId=${jobId.slice(0,8)} remoteTaskId=${remoteTaskId}`);

    const { Queue } = await import("bullmq");
    const pollQueue = new Queue("runway-poll", { connection });
    await pollQueue.add("poll", { jobId, remoteTaskId, duration, resolution, quality, cfgScale, sound, videoUrl }, { jobId: `poll-${jobId}`, delay: 15000 });

  } catch (err: any) {
    const msg = err.message || String(err);
    if (msg === "COOLDOWN" || msg === "CONCURRENCY_FULL" || msg === "USER_CONCURRENCY") throw err;
    console.error(`[submit-worker] jobId=${jobId.slice(0,8)} error: ${msg}`);
    if (msg === "RATE_LIMITED") {
      await tokenPool.setCooldown(tok.id);
      await prisma.runwayJob.update({ where: { id: jobId }, data: { status: "pending" } });
      throw Object.assign(new Error("COOLDOWN"), { name: "COOLDOWN" });
    }
    await prisma.runwayJob.update({
      where: { id: jobId },
      data: { status: "failed", errorMessage: msg, finishedAt: new Date() },
    });
  }
}, {
  connection,
  concurrency: 1,
  settings: {
    backoffStrategy: (_attempts: number, _type: string, err: Error) => {
      if (err?.message === "COOLDOWN") return 70000;
      if (err?.message === "USER_CONCURRENCY") return 20000; // check again in 20s
      return 30000; // CONCURRENCY_FULL or default
    },
  },
});

console.log("[submit-worker] listening on runway-submit (kling_3_0_standard)");
