// routes/review.ts — 生图审图 Agent API
import { Router } from "express";
import { prisma } from "../services/prisma";
import { authMiddleware } from "../middleware/auth";
import {
  startRound,
  startSafetyNet,
  onSeedreamCompleted,
} from "../services/review.engine";
import { reviewBus } from "../services/review.bus";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../middleware/auth";

export const reviewRouter = Router();

// kick off safety net once router is loaded
startSafetyNet();

// expose hook for runway.ts polling integration
export { onSeedreamCompleted };

// POST /api/review/tasks — create task
reviewRouter.post("/tasks", authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "未登录" });
    const {
      title,
      genPrompt,
      qcPrompt,
      refImages,
      aspectRatio,
      resolution,
      targetCount,
      overGenRatio,
      maxRounds,
    } = req.body || {};
    if (!genPrompt || !String(genPrompt).trim())
      return res.status(400).json({ error: "生成 prompt 不能为空" });
    if (!qcPrompt || !String(qcPrompt).trim())
      return res.status(400).json({ error: "质检 prompt 不能为空" });
    const tc = Math.max(1, Math.min(20, Number(targetCount) || 1));
    const ogr = Math.max(1, Math.min(4, Number(overGenRatio) || 2));
    const mr = Math.max(1, Math.min(5, Number(maxRounds) || 3));

    const task = await prisma.reviewTask.create({
      data: {
        userId,
        title: title || null,
        genPrompt: String(genPrompt),
        qcPrompt: String(qcPrompt),
        refImages: Array.isArray(refImages) ? (refImages as any) : null,
        aspectRatio: aspectRatio || "1:1",
        resolution: resolution || "2k",
        targetCount: tc,
        overGenRatio: ogr,
        maxRounds: mr,
        status: "running",
      },
    });

    // fire and forget round 1
    startRound(task.id).catch((e) =>
      console.error("[review] startRound error:", e?.message)
    );

    res.json({ task });
  } catch (e: any) {
    console.error("[review] create task:", e);
    res.status(500).json({ error: e.message || "创建失败" });
  }
});

// GET /api/review/tasks — list current user's tasks
reviewRouter.get("/tasks", authMiddleware, async (req: any, res: any) => {
  try {
    const isAdmin = req.user?.role === "admin";
    const queryUserId = req.query.userId as string | undefined;
    const userId = isAdmin && queryUserId ? queryUserId : req.user?.id;
    const status = req.query.status as string | undefined;
    const where: any = { userId };
    if (status) where.status = status;
    const rows = await prisma.reviewTask.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        items: { select: { id: true, status: true } },
      },
      take: 200,
    });
    const tasks = rows.map((t) => ({
      ...t,
      itemsCount: t.items.length,
      passedCount: t.passedCount,
      items: undefined,
    }));
    res.json({ tasks });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/review/tasks/:id
reviewRouter.get("/tasks/:id", authMiddleware, async (req: any, res: any) => {
  try {
    const isAdmin = req.user?.role === "admin";
    const task = await prisma.reviewTask.findUnique({
      where: { id: req.params.id },
    });
    if (!task) return res.status(404).json({ error: "未找到" });
    if (!isAdmin && task.userId !== req.user?.id)
      return res.status(403).json({ error: "无权限" });
    const items = await prisma.reviewItem.findMany({
      where: { taskId: task.id },
      orderBy: [{ round: "asc" }, { createdAt: "asc" }],
    });
    res.json({ task, items });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/review/tasks/:id/cancel
reviewRouter.post("/tasks/:id/cancel", authMiddleware, async (req: any, res: any) => {
  try {
    const isAdmin = req.user?.role === "admin";
    const task = await prisma.reviewTask.findUnique({ where: { id: req.params.id } });
    if (!task) return res.status(404).json({ error: "未找到" });
    if (!isAdmin && task.userId !== req.user?.id)
      return res.status(403).json({ error: "无权限" });
    const updated = await prisma.reviewTask.update({
      where: { id: task.id },
      data: { status: "cancelled" },
    });
    res.json({ task: updated });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/review/tasks/:id/extend
reviewRouter.post("/tasks/:id/extend", authMiddleware, async (req: any, res: any) => {
  try {
    const isAdmin = req.user?.role === "admin";
    const task = await prisma.reviewTask.findUnique({ where: { id: req.params.id } });
    if (!task) return res.status(404).json({ error: "未找到" });
    if (!isAdmin && task.userId !== req.user?.id)
      return res.status(403).json({ error: "无权限" });
    if (task.status !== "partial")
      return res.status(400).json({ error: "仅 partial 状态可扩展" });
    const updated = await prisma.reviewTask.update({
      where: { id: task.id },
      data: {
        status: "running",
        maxRounds: Math.min(5, task.maxRounds + 1),
      },
    });
    startRound(task.id).catch((e) =>
      console.error("[review] extend startRound:", e?.message)
    );
    res.json({ task: updated });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/review/items/:id/retry
reviewRouter.post("/items/:id/retry", authMiddleware, async (req: any, res: any) => {
  try {
    const isAdmin = req.user?.role === "admin";
    const item = await prisma.reviewItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: "未找到" });
    const task = await prisma.reviewTask.findUnique({ where: { id: item.taskId } });
    if (!task) return res.status(404).json({ error: "任务不存在" });
    if (!isAdmin && task.userId !== req.user?.id)
      return res.status(403).json({ error: "无权限" });

    const { createSeedreamJobForReview } = await import("../services/review.engine");
    const job = await createSeedreamJobForReview({
      userId: task.userId,
      prompt: task.genPrompt,
      aspectRatio: task.aspectRatio,
      resolution: task.resolution,
      referenceImages: task.refImages as any,
    });
    const updated = await prisma.reviewItem.update({
      where: { id: item.id },
      data: {
        status: "generating",
        seedreamJobId: job.id,
        lastReason: null,
      },
    });
    res.json({ item: updated });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "重试失败" });
  }
});

// GET /api/review/tasks/:id/stream — SSE event stream
reviewRouter.get("/tasks/:id/stream", async (req: any, res: any) => {
  try {
    // auth via header or ?token=
    let token = "";
    const auth = req.headers["authorization"] as string;
    if (auth?.startsWith("Bearer ")) token = auth.slice(7);
    else if (req.query.token) token = String(req.query.token);
    if (!token) return res.status(401).json({ error: "未登录" });
    let user: any;
    try {
      user = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: "token 无效" });
    }
    const taskId = req.params.id;
    const task = await prisma.reviewTask.findUnique({ where: { id: taskId } });
    if (!task) return res.status(404).json({ error: "未找到" });
    const isAdmin = user?.role === "admin";
    if (!isAdmin && task.userId !== user?.id)
      return res.status(403).json({ error: "无权限" });

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    const send = (evt: any) => {
      try {
        res.write(`event: ${evt.type}\n`);
        res.write(`data: ${JSON.stringify(evt)}\n\n`);
      } catch {}
    };

    // replay last 200 historical events
    const history = await prisma.reviewEvent.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    for (const h of history) {
      const pl = (h.payload && typeof h.payload === 'object' && !Array.isArray(h.payload)) ? (h.payload as any) : {};
      send({ ...pl, id: h.id, taskId: h.taskId, itemId: h.itemId, round: h.round, type: h.type, payload: h.payload, createdAt: h.createdAt });
    }

    // if task already terminal → close after replay
    if (["done", "partial", "cancelled"].includes(task.status)) {
      send({ type: "close", taskId, payload: { status: task.status } });
      return res.end();
    }

    const channel = `task:${taskId}`;
    const listener = (evt: any) => {
      send(evt);
      if (["task_done", "task_partial"].includes(evt.type)) {
        try {
          send({ type: "close", taskId, payload: { reason: evt.type } });
          res.end();
        } catch {}
        reviewBus.off(channel, listener);
      }
    };
    reviewBus.on(channel, listener);

    const heartbeat = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {}
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      reviewBus.off(channel, listener);
    });
  } catch (e: any) {
    console.error("[review SSE]", e);
    try {
      res.status(500).json({ error: e.message });
    } catch {}
  }
});
