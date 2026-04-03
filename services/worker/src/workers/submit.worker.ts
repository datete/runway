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

new Worker("runway-submit", async (job: Job) => {
  const { jobId, duration } = job.data;
  console.log(`[submit-worker] attempt=${job.attemptsMade+1} jobId=${jobId.slice(0,8)}`);

  const dbJob = await prisma.runwayJob.findUnique({ where: { id: jobId } });
  if (!dbJob || ["cancelled", "completed", "processing"].includes(dbJob.status)) {
    console.log(`[submit-worker] job ${jobId.slice(0,8)} cancelled/missing, skip`);
    return;
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

  // Concurrency check
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
    });

    await prisma.runwayJob.update({
      where: { id: jobId },
      data: { remoteTaskId, status: "processing" },
    });
    console.log(`[submit-worker] jobId=${jobId.slice(0,8)} remoteTaskId=${remoteTaskId}`);

    const { Queue } = await import("bullmq");
    const pollQueue = new Queue("runway-poll", { connection });
    await pollQueue.add("poll", { jobId, remoteTaskId }, { jobId: `poll-${jobId}`, delay: 15000 });

  } catch (err: any) {
    const msg = err.message || String(err);
    if (msg === "COOLDOWN" || msg === "CONCURRENCY_FULL") throw err; // BullMQ retry
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
      return 30000; // CONCURRENCY_FULL or default
    },
  },
});

console.log("[submit-worker] listening on runway-submit (kling_3_0_standard)");
