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
      const userId = req.user?.id;
      const job = await svc.createJob({ prompt, mode, imageUrl, imageUrls, duration, exploreMode, model, remark, userId, resolution, quality, cfgScale, sound, videoUrl });
      logAction(userId, "create_job", `jobId=${job.id} mode=${mode}`, req.socket.remoteAddress);
      res.status(201).json(job);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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

  async listJobs(req: Request, res: Response) {
    try {
      const jobs = await svc.listJobs(req.user?.id, req.user?.role);

      // Calculate global queue positions for active jobs
      const globalQueue = await prisma.runwayJob.findMany({
        where: { status: { in: ACTIVE_STATUSES } },
        orderBy: { createdAt: "asc" },
        select: { id: true, status: true, createdAt: true },
      });

      const positionMap = new Map<string, number>();
      globalQueue.forEach((qj, idx) => {
        positionMap.set(qj.id, idx + 1);
      });

      const enriched = jobs.map((job: any) => ({
        ...job,
        queuePosition: ACTIVE_STATUSES.includes(job.status) ? (positionMap.get(job.id) || null) : null,
        queueTotal: globalQueue.length,
      }));

      res.json(enriched);
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

  async batchCreateJobs(req: Request, res: Response) {
    try {
      const { prompts, mode, imageUrl, duration, resolution, quality, cfgScale, sound, videoUrl } = req.body;

      if (!Array.isArray(prompts) || prompts.length === 0) {
        return res.status(400).json({ error: "prompts must be a non-empty array" });
      }
      if (prompts.length > 20) {
        return res.status(400).json({ error: "prompts array exceeds maximum of 20 items" });
      }
      if (!mode) {
        return res.status(400).json({ error: "mode is required" });
      }

      const userId = req.user?.id;
      const created: { jobId: string; prompt: string }[] = [];
      const errors: { prompt: string; error: string }[] = [];

      for (const prompt of prompts) {
        if (!prompt || typeof prompt !== "string") {
          errors.push({ prompt: String(prompt), error: "invalid or empty prompt" });
          continue;
        }
        try {
          const job = await svc.createJob({
            prompt, mode, imageUrl, duration, resolution, quality, cfgScale, sound, videoUrl, userId,
          });
          created.push({ jobId: job.id, prompt });
        } catch (e: any) {
          errors.push({ prompt, error: e.message ?? "unknown error" });
        }
      }

      logAction(userId, "batch_create_jobs",
        `total=${prompts.length} created=${created.length} errors=${errors.length} mode=${mode}`,
        req.socket.remoteAddress);

      return res.status(201).json({ total: prompts.length, created, errors });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }
}
