// review.engine.ts — 生图审图 Agent 调度引擎 (含事件总线 + 流式 gpt-5)
import { prisma } from "./prisma";
import { emitReviewEvent } from "./review.bus";

const MAX_ROUNDS_HARD_CAP = 5;
const MAX_ATTEMPTS = 10;
// ─── runway helpers (mirrors routes/runway.ts internals) ─────────────
async function _runwayFetch(path: string, init: any, account: any) {
  const fetchMod = await import("node-fetch");
  const fetch: any = (fetchMod as any).default || fetchMod;
  const headers = {
    Authorization: `Bearer ${account.token}`,
    "Content-Type": "application/json",
    "X-Runway-Workspace": account.teamId,
    ...(init.headers || {}),
  };
  let agent: any;
  if (account.proxyUrl) {
    try {
      if (account.proxyUrl.startsWith("socks")) {
        const { SocksProxyAgent } = await import("socks-proxy-agent");
        agent = new SocksProxyAgent(account.proxyUrl);
      } else {
        const { HttpsProxyAgent } = await import("https-proxy-agent");
        agent = new HttpsProxyAgent(account.proxyUrl);
      }
    } catch {}
  }
  const res = await fetch(`https://api.runwayml.com${path}`, {
    ...init,
    headers,
    ...(agent ? { agent } : {}),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

async function _pickSeedreamAccount() {
  const accounts = await prisma.runwayAccount.findMany({
    where: { isActive: true },
    orderBy: [{ priority: "desc" }, { lastUsedAt: "asc" }],
  });
  return accounts[0] || null;
}

// ─── seedream job creation (extracted) ───────────────────────────────
export async function createSeedreamJobForReview(opts: {
  userId: string;
  prompt: string;
  aspectRatio: string;
  resolution: string;
  referenceImages?: any;
}) {
  const options: any = {
    name: `Review - ${opts.prompt.slice(0, 20)}`,
    prompt: opts.prompt,
    aspectRatio: opts.aspectRatio,
    resolution: opts.resolution,
    numImages: 1,
    exploreMode: true,
    creationSource: "tool-mode",
  };
  if (Array.isArray(opts.referenceImages) && opts.referenceImages.length > 0) {
    options.referenceImages = opts.referenceImages
      .filter((r: any) => r && r.assetId && r.url)
      .map((r: any, i: number) => ({
        tag: r.tag || `IMG_${i + 1}`,
        url: r.url,
        assetId: r.assetId,
      }));
  }

  const MAX_RETRIES = 8;
  let lastError: any = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const account = await _pickSeedreamAccount();
    if (!account) {
      await new Promise((res) => setTimeout(res, 5000));
      continue;
    }

    const body = { taskType: "seedream_5", asTeamId: Number(account.teamId), options };
    const r = await _runwayFetch("/v1/tasks", { method: "POST", body: JSON.stringify(body) }, account);

    if (!r.ok) {
      const is429 = r.status === 429 || /too many tasks/i.test(r.text || "");
      if (is429) {
        await prisma.runwayAccount
          .update({
            where: { id: account.id },
            data: {
              lastErrorAt: new Date(),
              lastErrorMessage: `seedream 429: ${(r.text || "").slice(0, 200)}`,
            },
          })
          .catch(() => {});
        const waitSec = Math.min(30, 3 * Math.pow(2, attempt));
        await new Promise((res) => setTimeout(res, waitSec * 1000));
        lastError = new Error(`API 429: ${(r.text || "").slice(0, 200)}`);
        continue;
      }
      await prisma.runwayAccount
        .update({
          where: { id: account.id },
          data: {
            lastErrorAt: new Date(),
            lastErrorMessage: `seedream create ${r.status}: ${r.text.slice(0, 300)}`,
          },
        })
        .catch(() => {});
      throw new Error(`API ${r.status}: ${r.text.slice(0, 300)}`);
    }

    const remoteTaskId = r.json?.id || r.json?.task?.id || r.json?.taskId;
    if (!remoteTaskId) throw new Error("未返回 taskId");

    const row = await prisma.seedreamJob.create({
      data: {
        userId: opts.userId,
        accountId: account.id,
        remoteTaskId,
        status: "pending",
        prompt: opts.prompt,
        aspectRatio: opts.aspectRatio,
        resolution: opts.resolution,
        numImages: 1,
        exploreMode: true,
        referenceImages: options.referenceImages || null,
      },
    });
    await prisma.runwayAccount
      .update({ where: { id: account.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
    return row;
  }
  throw lastError || new Error("seedream 入队 429 重试上限");
}

// ─── batch sizing ────────────────────────────────────────────────────
export function batchSizeForRound(task: any): number {
  const remaining = task.targetCount - task.passedCount;
  if (remaining <= 0) return 0;
  return Math.max(Math.ceil(remaining * (task.overGenRatio || 2)), 2);
}

async function aggregateRejectReasons(
  taskId: string,
  round: number
): Promise<{ hint: string; topReasons: Array<{ reason: string; count: number }> }> {
  const items = await prisma.reviewItem.findMany({
    where: { taskId, round, status: { in: ["rejected", "failed"] } },
    select: { lastReason: true },
  });
  const reasons = items.map((i) => i.lastReason).filter(Boolean) as string[];
  if (reasons.length === 0) return { hint: "", topReasons: [] };
  const tally: Record<string, number> = {};
  reasons.forEach((r) => {
    const key = r.slice(0, 80);
    tally[key] = (tally[key] || 0) + 1;
  });
  const top = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));
  const hint = top.map((t) => `${t.reason}(x${t.count})`).join("; ");
  return { hint, topReasons: top };
}

// ─── start a round ────────────────────────────────────────────────────
export async function startRound(taskId: string) {
  const task = await prisma.reviewTask.findUnique({ where: { id: taskId } });
  if (!task) return;
  if (task.status !== "running") return;
  const cap = Math.min(task.maxRounds, MAX_ROUNDS_HARD_CAP);
  if (task.currentRound >= cap) {
    await prisma.reviewTask.update({ where: { id: taskId }, data: { status: "partial" } });
    await emitReviewEvent({ taskId, type: "task_partial", payload: { reason: "max_rounds_reached" } });
    return;
  }
  const nextRound = task.currentRound + 1;
  const n = batchSizeForRound(task);
  if (n === 0) {
    await prisma.reviewTask.update({ where: { id: taskId }, data: { status: "done" } });
    await emitReviewEvent({ taskId, type: "task_done", payload: { passedCount: task.passedCount } });
    return;
  }

  let hint = "";
  if (nextRound > 1) {
    const agg = await aggregateRejectReasons(taskId, nextRound - 1);
    if (agg.hint) {
      hint = `\n\n上一轮被拒原因汇总（请避免）: ${agg.hint}`;
      await emitReviewEvent({
        taskId,
        round: nextRound - 1,
        type: "reject_analysis",
        payload: { round: nextRound - 1, topReasons: agg.topReasons, rewrittenPromptHint: hint.trim() },
      });
    }
  }
  const prompt = task.genPrompt + hint;

  await prisma.reviewTask.update({
    where: { id: taskId },
    data: { currentRound: nextRound },
  });

  await emitReviewEvent({
    taskId,
    round: nextRound,
    type: "round_start",
    payload: { round: nextRound, batchSize: n, hint: hint.trim() || null },
  });

  for (let i = 0; i < n; i++) {
    if (i > 0) {
      await new Promise((res) => setTimeout(res, 3000 + Math.floor(Math.random() * 2000)));
    }
    const item = await prisma.reviewItem.create({
      data: { taskId, round: nextRound, status: "pending" },
    });
    try {
      const job = await createSeedreamJobForReview({
        userId: task.userId,
        prompt,
        aspectRatio: task.aspectRatio,
        resolution: task.resolution,
        referenceImages: task.refImages as any,
      });
      await prisma.reviewItem.update({
        where: { id: item.id },
        data: { seedreamJobId: job.id, status: "generating" },
      });
      await emitReviewEvent({
        taskId,
        itemId: item.id,
        round: nextRound,
        type: "item_queued",
        payload: { itemId: item.id, seedreamJobId: job.id },
      });
    } catch (e: any) {
      await prisma.reviewItem.update({
        where: { id: item.id },
        data: { status: "failed", lastReason: e.message || "seedream 入队失败" },
      });
      await emitReviewEvent({
        taskId,
        itemId: item.id,
        round: nextRound,
        type: "error",
        payload: { stage: "enqueue", message: e.message },
      });
    }
  }

  await maybeAdvanceRound(taskId);
}

// ─── streaming vision review call ────────────────────────────────────
export async function reviewImage(
  qcPrompt: string,
  imageUrl: string,
  ctx?: { taskId: string; itemId: string; round: number }
): Promise<{ pass: boolean; reason: string; suggestions: string; raw: string }> {
  try {
    const fetchMod = await import("node-fetch");
    const fetch: any = (fetchMod as any).default || fetchMod;
    const body = {
      model: "gpt-5",
      stream: true,
      messages: [
        {
          role: "system",
          content:
            "你是严格的图像质检员。只输出 JSON {pass:boolean, reason:string, suggestions:string}",
        },
        {
          role: "user",
          content: [
            { type: "text", text: qcPrompt + "\n输出格式: JSON" },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    };
    const r = await fetch("https://api.iplcz.cn/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AI_OPTIMIZE_API_KEY || ""}`,
      },
      body: JSON.stringify(body),
    });

    if (!(r as any).ok) {
      const errText = await (r as any).text().catch(() => "");
      const bodySnippet = errText || "";
      console.error("[review.engine] upstream error", (r as any).status, errText.slice(0, 500));
      if (ctx) {
        try {
          await emitReviewEvent({
            taskId: ctx.taskId, itemId: ctx.itemId, round: ctx.round,
            type: "review_token", persist: false,
            payload: { itemId: ctx.itemId, delta: `[审核服务暂不可用 ${(r as any).status}] ${bodySnippet.slice(0,120)}
将在下一轮自动重试…` },
          });
          await emitReviewEvent({
            taskId: ctx.taskId, itemId: ctx.itemId, round: ctx.round,
            type: "review_done", persist: false,
            payload: { itemId: ctx.itemId, pass: false, reason: `审核上游错误 ${(r as any).status}`, suggestions: "" },
          });
        } catch {}
      }
      return { pass: false, reason: `审核上游错误 ${(r as any).status}: ${errText.slice(0, 200)}`, suggestions: "", raw: errText };
    }

    let raw = "";
    let buffer = "";
    let pendingDelta = "";
    let lastFlush = Date.now();
    const flush = async (force = false) => {
      if (!ctx) return;
      const now = Date.now();
      if (force || pendingDelta.length >= 20 || now - lastFlush >= 500) {
        if (pendingDelta) {
          await emitReviewEvent({
            taskId: ctx.taskId,
            itemId: ctx.itemId,
            round: ctx.round,
            type: "review_token",
            payload: { itemId: ctx.itemId, delta: pendingDelta },
            persist: false,
          });
          pendingDelta = "";
          lastFlush = now;
        }
      }
    };

    // node-fetch v2 streams via .body (Node Readable)
    const stream: any = (r as any).body;
    let pingTimer: NodeJS.Timeout | null = null;
    let firstDeltaReceived = false;
    if (ctx) {
      pingTimer = setInterval(() => {
        if (firstDeltaReceived) return;
        emitReviewEvent({
          taskId: ctx.taskId, itemId: ctx.itemId, round: ctx.round,
          type: "review_token", persist: false,
          payload: { itemId: ctx.itemId, delta: "·" },
        }).catch(() => {});
      }, 800);
    }
    const clearPing = () => { if (pingTimer) { clearInterval(pingTimer); pingTimer = null; } };
    try {
    if (stream && typeof stream.on === "function") {
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf-8");
          let idx;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const lines = block.split("\n");
            for (const line of lines) {
              const t = line.trim();
              if (!t.startsWith("data:")) continue;
              const data = t.slice(5).trim();
              if (data === "[DONE]") continue;
              try {
                const j = JSON.parse(data);
                const delta = j?.choices?.[0]?.delta?.content || j?.choices?.[0]?.message?.content || "";
                if (delta) {
                  if (!firstDeltaReceived) { firstDeltaReceived = true; clearPing(); }
                  raw += delta;
                  pendingDelta += delta;
                  flush(false).catch(() => {});
                }
              } catch {}
            }
          }
        });
        stream.on("end", () => resolve());
        stream.on("error", (e: any) => reject(e));
      });
    } else {
      // fallback non-stream
      raw = await (r as any).text();
      try {
        const j = JSON.parse(raw);
        raw = j?.choices?.[0]?.message?.content || raw;
      } catch {}
    }
    await flush(true);
    } finally {
      clearPing();
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch {}
      }
    }
    if (!parsed || typeof parsed.pass !== "boolean") {
      return { pass: false, reason: "审核解析失败", suggestions: "", raw };
    }
    return {
      pass: !!parsed.pass,
      reason: String(parsed.reason || ""),
      suggestions: String(parsed.suggestions || ""),
      raw,
    };
  } catch (e: any) {
    return { pass: false, reason: `审核异常: ${e.message || "unknown"}`, suggestions: "", raw: "" };
  }
}

// ─── seedream completed hook ─────────────────────────────────────────
export async function onSeedreamCompleted(seedreamJobId: string, imageUrl: string) {
  try {
    const item = await prisma.reviewItem.findFirst({ where: { seedreamJobId } });
    if (!item) return;
    if (["passed", "rejected", "failed"].includes(item.status)) return;
    const task = await prisma.reviewTask.findUnique({ where: { id: item.taskId } });
    if (!task || task.status !== "running") return;

    await emitReviewEvent({
      taskId: task.id,
      itemId: item.id,
      round: item.round,
      type: "seedream_done",
      payload: { itemId: item.id, imageUrl },
    });

    await prisma.reviewItem.update({
      where: { id: item.id },
      data: { status: "reviewing", currentImageUrl: imageUrl },
    });

    await emitReviewEvent({
      taskId: task.id,
      itemId: item.id,
      round: item.round,
      type: "review_start",
      payload: { itemId: item.id },
    });

    const result = await reviewImage(task.qcPrompt, imageUrl, {
      taskId: task.id,
      itemId: item.id,
      round: item.round,
    });

    await emitReviewEvent({
      taskId: task.id,
      itemId: item.id,
      round: item.round,
      type: "review_done",
      payload: {
        itemId: item.id,
        pass: result.pass,
        reason: result.reason,
        suggestions: result.suggestions,
        raw: result.raw?.slice(0, 2000),
      },
    });

    const history = Array.isArray(item.history) ? (item.history as any[]) : [];
    history.push({
      attempt: history.length + 1,
      imageUrl,
      pass: result.pass,
      reason: result.reason,
      suggestions: result.suggestions,
      at: new Date().toISOString(),
    });

    if (result.pass) {
      await prisma.reviewItem.update({
        where: { id: item.id },
        data: {
          status: "passed",
          finalImageUrl: imageUrl,
          history: history as any,
          lastReason: result.reason,
        },
      });
      await prisma.reviewTask.update({
        where: { id: task.id },
        data: { passedCount: { increment: 1 } },
      });
      await emitReviewEvent({
        taskId: task.id,
        itemId: item.id,
        round: item.round,
        type: "item_passed",
        payload: { itemId: item.id },
      });
    } else {
      const attempts = history.length;
      const newStatus = attempts >= MAX_ATTEMPTS ? "failed" : "rejected";
      await prisma.reviewItem.update({
        where: { id: item.id },
        data: {
          status: newStatus,
          history: history as any,
          lastReason: result.reason,
        },
      });
      await emitReviewEvent({
        taskId: task.id,
        itemId: item.id,
        round: item.round,
        type: "item_rejected",
        payload: { itemId: item.id, reason: result.reason, status: newStatus },
      });
    }

    await maybeAdvanceRound(item.taskId);
  } catch (e: any) {
    console.error("[review.engine] onSeedreamCompleted error:", e?.message || e);
  }
}

export async function onSeedreamFailed(seedreamJobId: string) {
  try {
    const item = await prisma.reviewItem.findFirst({ where: { seedreamJobId } });
    if (!item) return;
    if (["passed", "rejected", "failed"].includes(item.status)) return;
    await prisma.reviewItem.update({
      where: { id: item.id },
      data: { status: "failed", lastReason: "seedream 生成失败" },
    });
    await emitReviewEvent({
      taskId: item.taskId,
      itemId: item.id,
      round: item.round,
      type: "error",
      payload: { stage: "seedream", message: "seedream failed" },
    });
    await maybeAdvanceRound(item.taskId);
  } catch (e: any) {
    console.error("[review.engine] onSeedreamFailed:", e?.message);
  }
}

export async function maybeAdvanceRound(taskId: string) {
  const task = await prisma.reviewTask.findUnique({ where: { id: taskId } });
  if (!task) return;
  if (task.status !== "running") return;
  const roundItems = await prisma.reviewItem.findMany({
    where: { taskId, round: task.currentRound },
  });
  if (roundItems.length === 0) return;
  const allDone = roundItems.every((i) =>
    ["passed", "rejected", "failed"].includes(i.status)
  );
  if (!allDone) return;

  const passed = roundItems.filter((i) => i.status === "passed").length;
  const rejected = roundItems.filter((i) => i.status === "rejected").length;
  const failed = roundItems.filter((i) => i.status === "failed").length;
  await emitReviewEvent({
    taskId,
    round: task.currentRound,
    type: "round_end",
    payload: { round: task.currentRound, passed, rejected, failed },
  });

  if (task.passedCount >= task.targetCount) {
    await prisma.reviewTask.update({ where: { id: taskId }, data: { status: "done" } });
    await emitReviewEvent({
      taskId,
      type: "task_done",
      payload: { passedCount: task.passedCount, target: task.targetCount },
    });
    return;
  }
  const cap = Math.min(task.maxRounds, MAX_ROUNDS_HARD_CAP);
  if (task.currentRound >= cap) {
    await prisma.reviewTask.update({ where: { id: taskId }, data: { status: "partial" } });
    await emitReviewEvent({
      taskId,
      type: "task_partial",
      payload: { passedCount: task.passedCount, target: task.targetCount },
    });
    return;
  }
  await startRound(taskId);
}

// ─── safety net: poll stuck items ────────────────────────────────────
async function safetyNetScan() {
  try {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    const stuck = await prisma.reviewItem.findMany({
      where: {
        status: { in: ["generating", "reviewing"] },
        updatedAt: { lt: cutoff },
        seedreamJobId: { not: null },
      },
      take: 20,
    });
    for (const item of stuck) {
      try {
        const job = await prisma.seedreamJob.findUnique({
          where: { id: item.seedreamJobId! },
        });
        if (!job) continue;
        if (
          job.status !== "SUCCEEDED" &&
          job.status !== "FAILED" &&
          job.remoteTaskId &&
          job.accountId
        ) {
          const account = await prisma.runwayAccount.findUnique({
            where: { id: job.accountId },
          });
          if (account) {
            const r = await _runwayFetch(
              `/v1/tasks/${job.remoteTaskId}?asTeamId=${account.teamId}`,
              { method: "GET" },
              account
            );
            if (r.ok && r.json) {
              const t = r.json.task || r.json;
              const status = (t.status || "").toUpperCase();
              if (status === "SUCCEEDED") {
                const artifacts = t.artifacts || t.output || [];
                const images = artifacts.map((a: any, i: number) => ({
                  index: i,
                  url: a.url || a.imageUrl || a,
                }));
                await prisma.seedreamJob.update({
                  where: { id: job.id },
                  data: { status, images: images as any },
                });
                if (images[0]?.url) {
                  await onSeedreamCompleted(job.id, images[0].url);
                }
                continue;
              } else if (status === "FAILED") {
                await prisma.seedreamJob.update({
                  where: { id: job.id },
                  data: { status, errorMessage: t.errorMessage || "任务失败" },
                });
                await onSeedreamFailed(job.id);
                continue;
              }
            }
          }
        }
        if (job.status === "SUCCEEDED") {
          const imgs = (job.images as any) || [];
          const url = imgs[0]?.url;
          if (url) await onSeedreamCompleted(job.id, url);
        } else if (job.status === "FAILED") {
          await onSeedreamFailed(job.id);
        }
      } catch (e: any) {
        console.error("[review.engine] safety net item error:", e?.message);
      }
    }
  } catch (e: any) {
    console.error("[review.engine] safety net scan error:", e?.message);
  }
}

async function fastPollScan() {
  try {
    const items = await prisma.reviewItem.findMany({
      where: { status: "generating", seedreamJobId: { not: null } },
      take: 30,
      orderBy: { createdAt: "asc" },
    });
    for (const item of items) {
      try {
        // FIX A: heartbeat progress
        try {
          const startTs = (item as any).updatedAt || (item as any).createdAt || new Date();
          const elapsed = Math.max(0, (Date.now() - new Date(startTs).getTime()) / 1000);
          const percent = Math.min(92, Math.floor(elapsed / 1.2));
          await emitReviewEvent({
            taskId: item.taskId, itemId: item.id, round: item.round,
            type: "seedream_progress", persist: false,
            payload: { itemId: item.id, percent, status: "generating" },
          });
        } catch {}
        const job = await prisma.seedreamJob.findUnique({ where: { id: item.seedreamJobId! } });
        if (!job || !job.remoteTaskId || !job.accountId) continue;
        if (job.status === "SUCCEEDED") {
          const imgs = (job.images as any) || [];
          if (imgs[0]?.url) await onSeedreamCompleted(job.id, imgs[0].url);
          continue;
        }
        if (job.status === "FAILED") {
          await onSeedreamFailed(job.id);
          continue;
        }
        const account = await prisma.runwayAccount.findUnique({ where: { id: job.accountId } });
        if (!account) continue;
        const r = await _runwayFetch(
          `/v1/tasks/${job.remoteTaskId}?asTeamId=${account.teamId}`,
          { method: "GET" },
          account
        );
        if (!r.ok || !r.json) continue;
        const t = r.json.task || r.json;
        const status = (t.status || "").toUpperCase();
        if (status === "SUCCEEDED") {
          const artifacts = t.artifacts || t.output || [];
          const images = artifacts.map((a: any, i: number) => ({ index: i, url: a.url || a.imageUrl || a }));
          await prisma.seedreamJob.update({ where: { id: job.id }, data: { status, images: images as any } });
          if (images[0]?.url) await onSeedreamCompleted(job.id, images[0].url);
        } else if (status === "FAILED") {
          await prisma.seedreamJob.update({
            where: { id: job.id },
            data: { status, errorMessage: t.errorMessage || "任务失败" },
          });
          await onSeedreamFailed(job.id);
        }
      } catch (e: any) {
        console.error("[review.engine] fastPoll item error:", e?.message);
      }
    }
  } catch (e: any) {
    console.error("[review.engine] fastPoll scan error:", e?.message);
  }
}

let _safetyTimer: NodeJS.Timeout | null = null;
let _fastTimer: NodeJS.Timeout | null = null;
export function startSafetyNet() {
  if (_safetyTimer) return;
  _safetyTimer = setInterval(safetyNetScan, 60 * 1000);
  _fastTimer = setInterval(fastPollScan, 6 * 1000);
  console.log("[review.engine] safety net started (60s) + fast poll (6s)");
}
