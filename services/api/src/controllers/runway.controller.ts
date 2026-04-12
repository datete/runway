import { Request, Response } from "express";
import { RunwayService } from "../services/runway/runway.service";
import { prisma } from "../services/prisma";

const svc = new RunwayService();

const ACTIVE_STATUSES = ["pending", "queued", "submitted", "processing"];

async function logAction(userId: string | undefined, action: string, detail?: string, ip?: string) {
  if (!userId) return;
  await prisma.userLog.create({ data: { userId, action, detail, ip } }).catch(() => {});
}

export class RunwayController {
  async createJob(req: Request, res: Response) {
    try {
      const { prompt, mode, imageUrl, imageUrls, duration, exploreMode, model, remark, resolution, quality, cfgScale, sound, videoUrl } = req.body;
      if (!prompt || !mode) return res.status(400).json({ error: "prompt and mode required" });
      if (typeof prompt === "string" && prompt.length > 2000) return res.status(400).json({ error: `提示词超出2000字上限（当前${prompt.length}字），请精简后再提交` });
      const userId = req.user?.id;
      const job = await svc.createJob({ prompt, mode, imageUrl, imageUrls, duration, exploreMode, model, remark, userId, resolution, quality, cfgScale, sound, videoUrl });
      logAction(userId, "create_job", `jobId=${job.id} mode=${mode}`, req.socket.remoteAddress);
      res.status(201).json(job);
    } catch (e: any) {
      const msg = e.message || "";
      const isValidation = msg.includes("同质化") || msg.includes("配额") || msg.includes("上限");
      res.status(isValidation ? 400 : 500).json({ error: msg });
    }
  }

  async getJob(req: Request, res: Response) {
    try {
      const job = await svc.getJob(req.params.id, req.user?.id, req.user?.role);
      if (!job) return res.status(404).json({ error: "not found" });
      res.json(job);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  // #2: Single query with ROW_NUMBER for queue positions instead of double query
  async listJobs(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 20;
      const status = req.query.status as string | undefined;
      const search = req.query.search as string | undefined;

      const tag = req.query.tag as string | undefined;
      const result = await svc.listJobs(req.user?.id, req.user?.role, { page, pageSize, status, search, tag });

      const queueData = await prisma.$queryRawUnsafe(`
        SELECT id,
               ROW_NUMBER() OVER (ORDER BY COALESCE(priority, 0) DESC, created_at ASC) AS position,
               COUNT(*) OVER () AS total
        FROM runway_jobs
        WHERE status IN ('pending', 'queued', 'submitted', 'processing')
      `) as any[];

      const positionMap = new Map<string, number>();
      let queueTotal = 0;
      for (const row of queueData) {
        positionMap.set(row.id, Number(row.position));
        queueTotal = Number(row.total);
      }

      const enriched = result.jobs.map((job: any) => ({
        ...job,
        queuePosition: ACTIVE_STATUSES.includes(job.status) ? (positionMap.get(job.id) || null) : null,
        queueTotal,
      }));

      res.json({ jobs: enriched, total: result.total, page: result.page, pageSize: result.pageSize, counts: result.counts });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  async retryJob(req: Request, res: Response) {
    try {
      const job = await svc.retryJob(req.params.id, req.user?.id, req.user?.role);
      logAction(req.user?.id, "retry_job", `jobId=${req.params.id}`, req.socket.remoteAddress);
      res.json(job);
    } catch (e: any) {
      if (e.message === "forbidden") return res.status(403).json({ error: "无权操作" });
      res.status(500).json({ error: e.message });
    }
  }

  async deleteJob(req: Request, res: Response) {
    try {
      await svc.deleteJob(req.params.id, req.user?.id, req.user?.role);
      logAction(req.user?.id, "delete_job", `jobId=${req.params.id}`, req.socket.remoteAddress);
      res.json({ ok: true });
    } catch (e: any) {
      if (e.message === "forbidden") return res.status(403).json({ error: "无权操作" });
      res.status(500).json({ error: e.message });
    }
  }

  async cancelJob(req: Request, res: Response) {
    try {
      const job = await svc.cancelJob(req.params.id, req.user?.id, req.user?.role);
      logAction(req.user?.id, "cancel_job", `jobId=${req.params.id}`, req.socket.remoteAddress);
      res.json(job);
    } catch (e: any) {
      if (e.message === "forbidden") return res.status(403).json({ error: "无权操作" });
      res.status(500).json({ error: e.message });
    }
  }

  // #5: Parallel batch creation with Promise.allSettled
  async batchCreateJobs(req: Request, res: Response) {
    try {
      const { prompts, mode, imageUrl, duration, resolution, quality, cfgScale, sound, videoUrl } = req.body;

      if (!Array.isArray(prompts) || prompts.length === 0) {
        return res.status(400).json({ error: "prompts must be a non-empty array" });
      }
      if (prompts.length > 15) {
        return res.status(400).json({ error: "提示词同质化严重，请修改提示词" });
      }
      if (!mode) {
        return res.status(400).json({ error: "mode is required" });
      }

      const userId = req.user?.id;
      const validPrompts: string[] = [];
      const errors: { prompt: string; error: string }[] = [];

      for (const p of prompts) {
        if (!p || typeof p !== "string") {
          errors.push({ prompt: String(p), error: "invalid or empty prompt" });
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
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }
}
