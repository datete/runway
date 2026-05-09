import { Router, Request, Response } from "express";
import IORedis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "../services/prisma";
import { submitQueue } from "../queues/runway.queue";

export const borrowRouter = Router();

const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

const PROVIDER_ENABLED_KEY = "borrow:provider:enabled";
const PROVIDER_MAX_KEY = "borrow:provider:max-concurrency";
const PROVIDER_RESERVE_KEY = "borrow:provider:reserve-slots";
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "deleted"]);

function toInt(value: string | null | undefined, fallback: number, min = 0, max = 1000): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

async function triggerSubmit(delay = 3000): Promise<void> {
  try {
    await submitQueue.add("submit-trigger", {}, {
      jobId: "submit-next",
      delay,
      removeOnComplete: true,
      removeOnFail: true,
    });
  } catch (e: any) {
    if (!String(e?.message || "").includes("already exists")) {
      console.warn("[borrow:triggerSubmit]", e?.message || e);
    }
  }
}

function publicBase(req: Request): string {
  const configured = process.env.BORROW_PUBLIC_BASE || process.env.WEB_BASE || "";
  if (configured) return configured.replace(/\/$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0];
  return `${proto}://${req.get("host")}`.replace(/\/$/, "");
}

function absoluteUrl(req: Request, value?: string | null): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${publicBase(req)}${value}`;
  return value;
}

async function buildCapacity() {
  const enabled = (await redis.get(PROVIDER_ENABLED_KEY)) === "1";
  const maxBorrow = toInt(await redis.get(PROVIDER_MAX_KEY), Number(process.env.BORROW_PROVIDER_MAX_CONCURRENCY) || 1, 0, 100);
  const reserveSlots = toInt(await redis.get(PROVIDER_RESERVE_KEY), Number(process.env.BORROW_PROVIDER_RESERVE_SLOTS) || 1, 0, 100);

  const accounts = await prisma.runwayAccount.findMany({
    where: { isActive: true },
    select: { id: true, maxConcurrency: true },
  });
  let totalSlots = 0;
  let usedSlots = 0;
  for (const account of accounts) {
    totalSlots += account.maxConcurrency || 0;
    const current = await redis.get(`account:concurrency:${account.id}`);
    usedSlots += current ? Math.max(0, Number(current) || 0) : 0;
  }
  const [localPending, localActive, borrowedShadowActive, borrowedShadowPending, cooldownKeys] = await Promise.all([
    prisma.runwayJob.count({ where: { provider: { not: "borrowed" }, status: { in: ["pending", "queued"] } } as any }),
    prisma.runwayJob.count({ where: { provider: { not: "borrowed" }, status: { in: ["submitted", "processing"] } } as any }),
    prisma.runwayJob.count({ where: { provider: "borrowed", status: { in: ["submitted", "processing"] } } as any }),
    prisma.runwayJob.count({ where: { provider: "borrowed", status: { in: ["pending", "queued"] } } as any }),
    redis.keys("account:cooldown:*").catch(() => [] as string[]),
  ]);
  const freeSlots = Math.max(0, totalSlots - usedSlots);
  const availableSlots = enabled ? Math.max(0, Math.min(maxBorrow, freeSlots - reserveSlots)) : 0;
  return {
    enabled,
    totalSlots,
    usedSlots,
    freeSlots,
    availableSlots,
    localPending,
    localActive,
    borrowedShadowActive,
    borrowedShadowPending,
    channelOccupied: borrowedShadowActive + borrowedShadowPending,
    cooldownAccounts: cooldownKeys.length,
    recent429: 0,
    failureRate: 0,
    avgDurationSeconds: null,
  };
}

borrowRouter.get("/capacity", async (req: Request, res: Response) => {
  try {
    res.json(await buildCapacity());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


borrowRouter.post("/control", async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    if (body.providerEnabled !== undefined) await redis.set(PROVIDER_ENABLED_KEY, body.providerEnabled ? "1" : "0");
    if (body.providerMaxConcurrency !== undefined) await redis.set(PROVIDER_MAX_KEY, String(toInt(String(body.providerMaxConcurrency), 1, 0, 100)));
    if (body.providerReserveSlots !== undefined) await redis.set(PROVIDER_RESERVE_KEY, String(toInt(String(body.providerReserveSlots), 1, 0, 100)));
    res.json({ ok: true, capacity: await buildCapacity() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

borrowRouter.post("/jobs", async (req: Request, res: Response) => {
  try {
    const capacity = await buildCapacity();
    if (!capacity.enabled) return res.status(409).json({ error: "borrow provider disabled" });
    if (capacity.availableSlots <= 0) return res.status(429).json({ error: "no borrow slots available", capacity });

    const body = req.body || {};
    const dispatchId = String(body.dispatchId || "");
    if (!dispatchId) return res.status(400).json({ error: "dispatchId is required" });
    if (!body.prompt || !body.mode) return res.status(400).json({ error: "prompt and mode are required" });

    const existing = await prisma.runwayJob.findFirst({
      where: { provider: "borrowed", remark: `borrow:${dispatchId}` },
    });
    if (existing) {
      return res.json({ ok: true, shadowJobId: existing.id, status: existing.status, duplicate: true });
    }

    const shadowJobId = uuidv4();
    const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls : undefined;
    const job = await prisma.runwayJob.create({
      data: {
        id: shadowJobId,
        userId: null,
        provider: "borrowed",
        mode: String(body.mode),
        prompt: String(body.prompt),
        imageUrl: body.imageUrl || null,
        referenceImages: imageUrls ? JSON.stringify(imageUrls) : (body.referenceImages || null),
        status: "pending",
        exploreMode: body.exploreMode ?? true,
        modelName: body.modelName || body.model || "gen4",
        duration: Number(body.duration) || 5,
        remark: `borrow:${dispatchId}`,
        resolution: body.resolution || null,
        quality: body.quality || null,
        cfgScale: body.cfgScale ?? null,
        sound: body.sound ?? null,
        videoUrl: body.videoUrl || null,
        executionMode: "borrowed_shadow",
        borrowDispatchId: dispatchId,
        borrowStatus: "accepted",
      } as any,
    });
    await triggerSubmit();
    res.json({ ok: true, shadowJobId: job.id, status: job.status });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

borrowRouter.get("/jobs/:dispatchId", async (req: Request, res: Response) => {
  try {
    const dispatchId = String(req.params.dispatchId || "");
    const job: any = await prisma.runwayJob.findFirst({
      where: { provider: "borrowed", remark: `borrow:${dispatchId}` },
    });
    if (!job) return res.status(404).json({ error: "shadow job not found" });
    res.json({
      ok: true,
      dispatchId,
      shadowJobId: job.id,
      status: job.status,
      progress: job.progress || 0,
      resultUrl: absoluteUrl(req, job.resultUrl),
      thumbnailUrl: absoluteUrl(req, job.thumbnailUrl),
      videoUrl: absoluteUrl(req, job.videoUrl || job.resultUrl),
      errorMessage: job.errorMessage || null,
      updatedAt: job.updatedAt,
      finishedAt: job.finishedAt,
      terminal: TERMINAL_STATUSES.has(job.status),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

borrowRouter.post("/jobs/:dispatchId/cancel", async (req: Request, res: Response) => {
  try {
    const dispatchId = String(req.params.dispatchId || "");
    const job: any = await prisma.runwayJob.findFirst({
      where: { provider: "borrowed", remark: `borrow:${dispatchId}` },
    });
    if (!job) return res.status(404).json({ error: "shadow job not found" });
    if (!TERMINAL_STATUSES.has(job.status)) {
      await prisma.runwayJob.update({
        where: { id: job.id },
        data: { status: "cancelled", finishedAt: new Date(), errorMessage: "borrow dispatch cancelled by controller" } as any,
      });
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
