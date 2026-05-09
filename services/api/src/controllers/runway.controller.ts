import { Request, Response } from "express";
import { RunwayService } from "../services/runway/runway.service";
import { prisma } from "../services/prisma";
import { ValidationError, ForbiddenError, NotFoundError, sendError } from "../errors";

export const runwayService = new RunwayService();
const svc = runwayService;

const ACTIVE_STATUSES = ["pending", "queued", "submitted", "processing"];
const LIST_STATS_CACHE_MS = Number(process.env.RUNWAY_LIST_STATS_CACHE_MS) || 5000;

let hourlyCompletedCache = { expiresAt: 0, value: 0 };
let queueTotalCache = { expiresAt: 0, value: 0 };
const queuePositionCache = new Map<string, { expiresAt: number; position: number; total: number }>();

async function getHourlyCompleted() {
  const now = Date.now();
  if (hourlyCompletedCache.expiresAt > now) return hourlyCompletedCache.value;
  const value = await prisma.runwayJob.count({
    where: {
      status: "completed",
      finishedAt: { gte: new Date(Date.now() - 3600_000) },
    },
  }).catch(() => 0);
  hourlyCompletedCache = { value, expiresAt: now + LIST_STATS_CACHE_MS };
  return value;
}

async function getQueueTotal() {
  const now = Date.now();
  if (queueTotalCache.expiresAt > now) return queueTotalCache.value;
  const value = await prisma.runwayJob.count({ where: { status: { in: ACTIVE_STATUSES } } }).catch(() => 0);
  queueTotalCache = { value, expiresAt: now + LIST_STATS_CACHE_MS };
  return value;
}

async function getQueuePositionsForJobs(jobIds: string[]) {
  const now = Date.now();
  const total = await getQueueTotal();
  const positionMap = new Map<string, number>();
  const missing: string[] = [];
  for (const id of jobIds) {
    const cached = queuePositionCache.get(id);
    if (cached && cached.expiresAt > now && cached.total === total) positionMap.set(id, cached.position);
    else missing.push(id);
  }

  if (missing.length > 0) {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const idList = missing.filter(id => uuidRe.test(id)).map(id => `'${id}'::uuid`).join(",");
    if (idList) {
      const rows = await prisma.$queryRawUnsafe(`
        WITH target AS (
          SELECT id, created_at, COALESCE(priority, 0) AS priority
          FROM runway_jobs
          WHERE id IN (${idList})
        )
        SELECT t.id::text AS id,
               (1 + COUNT(o.id))::int AS position
        FROM target t
        LEFT JOIN runway_jobs o
          ON o.status IN ('pending', 'queued', 'submitted', 'processing')
         AND (
           COALESCE(o.priority, 0) > t.priority
           OR (
             COALESCE(o.priority, 0) = t.priority
             AND (
               o.created_at < t.created_at
               OR (o.created_at = t.created_at AND o.id::text < t.id::text)
             )
           )
         )
        GROUP BY t.id
      `) as any[];
      for (const row of rows) {
        const position = Number(row.position);
        positionMap.set(row.id, position);
        queuePositionCache.set(row.id, { position, total, expiresAt: now + LIST_STATS_CACHE_MS });
      }
    }
  }

  return { positionMap, queueTotal: total };
}

async function logAction(userId: string | undefined, action: string, detail?: string, ip?: string) {
  if (!userId) return;
  await prisma.userLog.create({ data: { userId, action, detail, ip } }).catch(() => {});
}

// Map legacy string error messages ("forbidden") from the service layer to typed errors.
// Temporary shim until the service layer is refactored to throw HttpError directly.
function mapServiceError(e: unknown): unknown {
  if (e instanceof Error && e.message === "forbidden") {
    return new ForbiddenError("无权操作");
  }
  return e;
}

export class RunwayController {
  async createJob(req: Request, res: Response) {
    try {
      const { prompt, mode, imageUrl, imageUrls, duration, exploreMode, model, remark, resolution, quality, cfgScale, sound, videoUrl } = req.body;
      if (!prompt || !mode) throw new ValidationError("prompt and mode required");
      if (typeof prompt !== "string") throw new ValidationError("prompt must be a string");
      if (typeof prompt === "string" && prompt.length > 2000) {
        throw new ValidationError(`提示词超出2000字上限（当前${prompt.length}字），请精简后再提交`);
      }
      const userId = req.user?.id;
      const job = await svc.createJob({ prompt, mode, imageUrl, imageUrls, duration, exploreMode, model, remark, userId, resolution, quality, cfgScale, sound, videoUrl });
      logAction(userId, "create_job", `jobId=${job.id} mode=${mode}`, req.socket.remoteAddress);
      res.status(201).json(job);
    } catch (e) {
      sendError(res, mapServiceError(e), "createJob");
    }
  }

  async getJob(req: Request, res: Response) {
    try {
      const job = await svc.getJob(req.params.id, req.user?.id, req.user?.role);
      if (!job) throw new NotFoundError("not found");
      res.json(job);
    } catch (e) {
      sendError(res, mapServiceError(e), "getJob");
    }
  }

  async listJobs(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 20;
      const status = req.query.status as string | undefined;
      const search = req.query.search as string | undefined;

      const tag = req.query.tag as string | undefined;
      const result = await svc.listJobs(req.user?.id, req.user?.role, { page, pageSize, status, search, tag });

      const activeJobIds = result.jobs.filter((job: any) => ACTIVE_STATUSES.includes(job.status)).map((job: any) => job.id);
      let positionMap = new Map<string, number>();
      let queueTotal = 0;
      let hourlyCompleted = 0;
      if (activeJobIds.length > 0) {
        try {
          const queueInfo = await getQueuePositionsForJobs(activeJobIds);
          positionMap = queueInfo.positionMap;
          queueTotal = queueInfo.queueTotal;
          hourlyCompleted = await getHourlyCompleted();
        } catch (err: any) {
          console.warn("[listJobs] queue stats skipped:", err?.message || err);
        }
      }

      const enriched = result.jobs.map((job: any) => {
        const isActiveJob = ACTIVE_STATUSES.includes(job.status);
        const queuePosition = isActiveJob ? (positionMap.get(job.id) || null) : null;
        return {
          ...job,
          queuePosition,
          queueTotal: isActiveJob ? queueTotal : null,
          hourlyCompleted: isActiveJob ? hourlyCompleted : null,
          etaMinutes: queuePosition && hourlyCompleted > 0
            ? Math.max(1, Math.ceil((queuePosition / hourlyCompleted) * 60))
            : null,
        };
      });

      res.json({ jobs: enriched, total: result.total, page: result.page, pageSize: result.pageSize, counts: result.counts });
    } catch (e) {
      sendError(res, e, "listJobs");
    }
  }

  async retryJob(req: Request, res: Response) {
    try {
      const job = await svc.retryJob(req.params.id, req.user?.id, req.user?.role);
      logAction(req.user?.id, "retry_job", `jobId=${req.params.id}`, req.socket.remoteAddress);
      res.json(job);
    } catch (e) {
      sendError(res, mapServiceError(e), "retryJob");
    }
  }

  async deleteJob(req: Request, res: Response) {
    try {
      await svc.deleteJob(req.params.id, req.user?.id, req.user?.role);
      logAction(req.user?.id, "delete_job", `jobId=${req.params.id}`, req.socket.remoteAddress);
      res.json({ ok: true });
    } catch (e) {
      sendError(res, mapServiceError(e), "deleteJob");
    }
  }

  async cancelJob(req: Request, res: Response) {
    try {
      const job = await svc.cancelJob(req.params.id, req.user?.id, req.user?.role);
      logAction(req.user?.id, "cancel_job", `jobId=${req.params.id}`, req.socket.remoteAddress);
      res.json(job);
    } catch (e) {
      sendError(res, mapServiceError(e), "cancelJob");
    }
  }

  async batchCreateJobs(req: Request, res: Response) {
    try {
      const { prompts, mode, imageUrl, duration, resolution, quality, cfgScale, sound, videoUrl } = req.body;

      if (!Array.isArray(prompts) || prompts.length === 0) {
        throw new ValidationError("prompts must be a non-empty array");
      }
      if (prompts.length > 15) {
        throw new ValidationError("单次最多提交 15 条提示词");
      }
      if (!mode) {
        throw new ValidationError("mode is required");
      }

      const userId = req.user?.id;
      const validPrompts: string[] = [];
      const errors: { prompt: string; error: string }[] = [];

      for (const p of prompts) {
        if (!p || typeof p !== "string") {
          errors.push({ prompt: String(p), error: "invalid or empty prompt" });
        } else if (p.length > 2000) {
          errors.push({ prompt: p, error: "prompt too long" });
        } else {
          validPrompts.push(p);
        }
      }

      const results = await Promise.allSettled(
        validPrompts.map((prompt) =>
          svc.createJob({ prompt, mode, imageUrl, duration, resolution, quality, cfgScale, sound, videoUrl, userId })
        )
      );

      const created: { jobId: string; prompt: string }[] = [];
      results.forEach((result, idx) => {
        if (result.status === "fulfilled") {
          created.push({ jobId: result.value.id, prompt: validPrompts[idx] });
        } else {
          errors.push({ prompt: validPrompts[idx], error: result.reason?.message ?? "unknown error" });
        }
      });

      logAction(userId, "batch_create_jobs",
        `total=${prompts.length} created=${created.length} errors=${errors.length} mode=${mode}`,
        req.socket.remoteAddress);

      return res.status(201).json({ total: prompts.length, created, errors });
    } catch (e) {
      return sendError(res, e, "batchCreateJobs");
    }
  }
}
