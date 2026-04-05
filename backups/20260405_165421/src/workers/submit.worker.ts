import { Worker, Job, Queue } from "bullmq";
import { RunwayDirectClient } from "../services/runway.direct";
import { prisma, redis as connection, accountPool } from "../services/shared";

const pollQueue = new Queue("runway-poll", { connection });
const submitQueue = new Queue("runway-submit", { connection });

// ═══════════════════════════════════════════════════════════════
// 人工行为模拟参数（所有延迟都在这里配置）
// ═══════════════════════════════════════════════════════════════

/** 提交前延迟：模拟人在页面上操作的时间 */
const PRE_SUBMIT_DELAY_MIN = 20_000;   // 20s
const PRE_SUBMIT_DELAY_MAX = 45_000;   // 45s

/** 提交后到下一次提交的间隔：模拟人看了下结果再操作 */
const POST_SUBMIT_DELAY_MIN = 60_000;  // 60s
const POST_SUBMIT_DELAY_MAX = 120_000; // 120s

/** 批次休息：每提交 N 个任务后，长休息一段时间 */
const BATCH_SIZE_MIN = 30;             // 最少提交30个
const BATCH_SIZE_MAX = 40;             // 最多提交40个再休息
const BATCH_REST_MIN = 30 * 60_000;    // 休息30分钟
const BATCH_REST_MAX = 40 * 60_000;    // 休息40分钟

/** 网络错误重试延迟 */
const NETWORK_RETRY_MIN = 30_000;      // 30s
const NETWORK_RETRY_MAX = 60_000;      // 60s

/** 安全网检查间隔 */
const SAFETY_NET_INTERVAL = 2 * 60_000; // 2分钟

// ═══════════════════════════════════════════════════════════════
// 批次计数器（per-account，Redis 持久化，重启不丢）
// 每个账号独立计数：提交 30~40 个后该账号休息 30~40 分钟
// ═══════════════════════════════════════════════════════════════

/** 随机整数 [min, max) */
function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min));
}

/** 获取某账号当前批次的目标数（首次随机生成） */
async function getBatchLimit(accountId: string): Promise<number> {
  const key = `submit:batch-limit:${accountId}`;
  const val = await connection.get(key);
  if (val) return parseInt(val, 10);
  const limit = randInt(BATCH_SIZE_MIN, BATCH_SIZE_MAX + 1);
  await connection.set(key, String(limit));
  console.log(`[batch:${accountId.slice(0,8)}] new batch limit: ${limit} tasks`);
  return limit;
}

/** 提交成功后递增该账号计数，返回是否需要休息 */
async function incrementBatchAndCheck(accountId: string, accountLabel: string): Promise<boolean> {
  const countKey = `submit:batch-count:${accountId}`;
  const count = await connection.incr(countKey);
  const limit = await getBatchLimit(accountId);
  console.log(`[batch:${accountLabel}] progress: ${count}/${limit}`);
  return count >= limit;
}

/** 某账号开始批次休息 */
async function startBatchRest(accountId: string, accountLabel: string): Promise<number> {
  const restMs = randInt(BATCH_REST_MIN, BATCH_REST_MAX + 1);
  const restSec = Math.ceil(restMs / 1000);
  const restKey = `submit:batch-resting:${accountId}`;
  const countKey = `submit:batch-count:${accountId}`;
  const limitKey = `submit:batch-limit:${accountId}`;
  await connection.set(restKey, "1", "EX", restSec);
  await connection.del(countKey);
  await connection.del(limitKey);
  console.log(`[batch:${accountLabel}] ★ batch complete! resting for ${(restMs / 60000).toFixed(0)} minutes`);
  return restMs;
}

/** 检查某账号是否正在休息 */
async function isAccountBatchResting(accountId: string): Promise<boolean> {
  const val = await connection.get(`submit:batch-resting:${accountId}`);
  return !!val;
}

/** 检查是否所有账号都在休息 */
async function areAllAccountsResting(): Promise<boolean> {
  const accounts = await accountPool.getAccounts();
  for (const acct of accounts) {
    if (!(await isAccountBatchResting(acct.id))) return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════
// 触发器（去重：同一时刻只有一个待执行的触发器）
// ═══════════════════════════════════════════════════════════════

/**
 * 触发一次提交尝试。
 * 去重逻辑：固定 jobId "submit-next"，只保留最早触发的那个。
 * 如果新触发更早，替换旧的。
 */
export async function triggerSubmit(delay = 0): Promise<void> {
  const effectiveDelay = Math.max(delay, 5000);
  try {
    const existing = await submitQueue.getJob("submit-next");
    if (existing) {
      const state = await existing.getState();
      if (state === "delayed" || state === "waiting") {
        const existingFireAt = (existing.timestamp || 0) + (existing.opts?.delay || 0);
        const newFireAt = Date.now() + effectiveDelay;
        if (newFireAt >= existingFireAt) return; // 现有的更早，保留
        await existing.remove().catch(() => {});
      }
    }
    await submitQueue.add("submit-trigger", {}, {
      jobId: "submit-next",
      delay: effectiveDelay,
      removeOnComplete: true,
      removeOnFail: true,
    });
  } catch (e: any) {
    if (!e.message?.includes("already exists")) {
      console.warn("[submit] triggerSubmit error:", e.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 核心提交逻辑
// ═══════════════════════════════════════════════════════════════

type SubmitResult = "submitted" | "no_pending" | "no_account" | "rate_limited" | "batch_resting" | "network_error" | "job_failed";

async function trySubmitOne(): Promise<SubmitResult> {
  // ── 快速检查（无副作用） ──

  // 1. 所有账号都在批次休息中？
  if (await areAllAccountsResting()) {
    console.log(`[submit-worker] all accounts batch resting`);
    return "batch_resting";
  }

  // 2. 全局限流冷却中？
  const globalCooldown = await connection.get("global:rate-limit-cooldown");
  if (globalCooldown) {
    const ttl = await connection.ttl("global:rate-limit-cooldown");
    console.log(`[submit-worker] global cooldown active (${ttl}s left)`);
    return "rate_limited";
  }

  // ── 僵尸任务清理 ──
  await prisma.$executeRawUnsafe(`
    UPDATE runway_jobs SET status = 'failed', error_message = '僵尸任务自动清理'
    WHERE status IN ('pending', 'queued')
      AND finished_at IS NOT NULL
      AND remote_task_id IS NULL
      AND account_id IS NULL
      AND updated_at < NOW() - INTERVAL '5 minutes'
  `).catch(() => {});

  // ── 获取可用账号（per-account 并发由 Redis Lua 原子控制） ──
  // 先尝试获取，然后检查该账号是否在批次休息
  let account = await accountPool.smartAcquire();
  if (!account) {
    console.log(`[submit-worker] no account with available slots`);
    return "no_account";
  }

  // 如果获取到的账号在批次休息中，释放它，尝试其他账号
  if (await isAccountBatchResting(account.id)) {
    const restTtl = await connection.ttl(`submit:batch-resting:${account.id}`);
    console.log(`[submit-worker] ${account.label} batch resting (${Math.ceil(restTtl / 60)}min left), trying other`);
    await accountPool.releaseNoJob(account.id);
    // 尝试排除该账号获取另一个
    const altAccount = await accountPool.smartAcquireExcluding(account.id);
    if (!altAccount) {
      console.log(`[submit-worker] no other account available`);
      return "batch_resting";
    }
    // 检查替代账号是否也在休息
    if (await isAccountBatchResting(altAccount.id)) {
      console.log(`[submit-worker] ${altAccount.label} also batch resting`);
      await accountPool.releaseNoJob(altAccount.id);
      return "batch_resting";
    }
    account = altAccount;
  }

  // ── 选取待处理任务（FIFO + 优先级） ──
  const pendingJobs = await prisma.$queryRawUnsafe(`
    SELECT id, status, prompt, mode, priority,
           user_id AS "userId",
           image_url AS "imageUrl",
           reference_images AS "referenceImages",
           explore_mode AS "exploreMode",
           model_name AS "modelName",
           result_url AS "resultUrl",
           error_message AS "errorMessage",
           retry_count AS "retryCount",
           created_at AS "createdAt",
           updated_at AS "updatedAt",
           started_at AS "startedAt",
           finished_at AS "finishedAt",
           used_token AS "usedToken",
           account_id AS "accountId",
           remote_task_id AS "remoteTaskId",
           duration, remark, resolution, quality,
           cfg_scale AS "cfgScale",
           sound, progress,
           video_url AS "videoUrl",
           thumbnail_url AS "thumbnailUrl"
    FROM runway_jobs
    WHERE status IN ('pending', 'queued')
    ORDER BY COALESCE(priority, 0) DESC, created_at ASC
    LIMIT 10
  `) as any[];

  if (pendingJobs.length === 0) {
    await accountPool.releaseNoJob(account.id);
    return "no_pending";
  }

  // ── 用户并发检查 ──
  let dbJob: any = null;
  for (const candidate of pendingJobs) {
    if (candidate.userId) {
      const user = await prisma.user.findUnique({
        where: { id: candidate.userId },
        select: { maxConcurrency: true },
      });
      if (user && user.maxConcurrency !== null) {
        const activeCount = await prisma.runwayJob.count({
          where: {
            userId: candidate.userId,
            status: { in: ["submitted", "processing"] },
            id: { not: candidate.id },
          },
        });
        if (activeCount >= user.maxConcurrency) {
          console.log(`[submit-worker] user ${candidate.userId} concurrency full (${activeCount}/${user.maxConcurrency}), skipping ${candidate.id.slice(0,8)}`);
          await prisma.runwayJob.update({ where: { id: candidate.id }, data: { status: "queued" } });
          continue;
        }
      }
    }
    dbJob = candidate;
    break;
  }

  if (!dbJob) {
    await accountPool.releaseNoJob(account.id);
    return "no_account";
  }

  const jobId: string = dbJob.id;

  // ── 已有远程任务？恢复轮询 ──
  if (dbJob.remoteTaskId) {
    console.log(`[submit-worker] job ${jobId.slice(0,8)} already has remote ${(dbJob.remoteTaskId as string).slice(0,8)}, resuming poll`);
    await prisma.runwayJob.update({ where: { id: jobId }, data: { status: "processing" } });
    await pollQueue.add("poll", {
      jobId, remoteTaskId: dbJob.remoteTaskId,
      accountId: dbJob.accountId || account.id,
    }, { jobId: `poll-${jobId}-${Date.now()}`, delay: 5000 });
    return "submitted";
  }

  console.log(`[submit-worker] picked jobId=${jobId.slice(0,8)} -> account=${account.label}`);

  // 锁定任务，防止重复选取
  await prisma.runwayJob.update({
    where: { id: jobId },
    data: { status: "submitted" },
  });

  // 解析参考图片
  let imageUrls: string[] | undefined;
  if (dbJob.referenceImages) {
    try { imageUrls = JSON.parse(dbJob.referenceImages); } catch (e: any) { console.warn("[submit] referenceImages parse error:", e.message); }
  }

  // ── 账号回避检查（之前在该账号失败过的任务） ──
  const avoidKey = `job:avoid-account:${jobId}:${account.id}`;
  const shouldAvoid = await connection.get(avoidKey);
  if (shouldAvoid) {
    const altAccount = await accountPool.smartAcquireExcluding(account.id);
    if (altAccount) {
      await accountPool.release(account.id);
      account = altAccount;
      console.log(`[submit-worker] switched to ${account.label} for ${jobId.slice(0,8)} (avoiding previous)`);
    } else {
      await connection.del(avoidKey);
    }
  }

  // 清理旧的释放标记
  await connection.del(`account:released:${account.id}:${jobId}`);

  const client = new RunwayDirectClient(account.token, Number(account.teamId), account.proxyUrl || undefined);

  try {
    await prisma.runwayJob.update({
      where: { id: jobId },
      data: { startedAt: new Date(), usedToken: account.tokenShort, accountId: account.id } as any,
    });

    // ── 人工延迟：模拟操作时间 ──
    const preSubmitDelay = randInt(PRE_SUBMIT_DELAY_MIN, PRE_SUBMIT_DELAY_MAX + 1);
    console.log(`[submit-worker] pre-submit delay ${(preSubmitDelay/1000).toFixed(0)}s for ${jobId.slice(0,8)} on ${account.label}`);
    await new Promise(r => setTimeout(r, preSubmitDelay));

    // ══════════════════════════════════════════════════════════
    // API 调用前三重检查（延迟期间情况可能已变）
    // ══════════════════════════════════════════════════════════

    // 检查1: 全局限流冷却
    const recheckCooldown = await connection.get("global:rate-limit-cooldown");
    if (recheckCooldown) {
      console.log(`[submit-worker] cooldown appeared during delay, aborting ${jobId.slice(0,8)}`);
      await accountPool.release(account.id);
      await prisma.runwayJob.update({ where: { id: jobId }, data: { status: "pending", accountId: null, startedAt: null } as any });
      return "rate_limited";
    }

    // 检查2: 账号冷却
    const acctCooldown = await connection.get(`account:cooldown:${account.id}`);
    if (acctCooldown) {
      console.log(`[submit-worker] account ${account.label} entered cooldown during delay, aborting ${jobId.slice(0,8)}`);
      await accountPool.release(account.id);
      await prisma.runwayJob.update({ where: { id: jobId }, data: { status: "pending", accountId: null, startedAt: null } as any });
      return "rate_limited";
    }

    // 检查3: 账号实际并发数（DB 权威数据）
    const acctActiveCount = await prisma.runwayJob.count({
      where: {
        accountId: account.id,
        status: { in: ["submitted", "processing"] },
        remoteTaskId: { not: null },
        id: { not: jobId },
      },
    });
    // Note: 'queued' (THROTTLED) tasks have DB status 'queued' and don't occupy real API slots
    if (acctActiveCount >= account.maxConcurrency) {
      console.log(`[submit-worker] account ${account.label} already has ${acctActiveCount}/${account.maxConcurrency} active tasks (DB), aborting ${jobId.slice(0,8)}`);
      await accountPool.release(account.id);
      await prisma.runwayJob.update({ where: { id: jobId }, data: { status: "pending", accountId: null, startedAt: null } as any });
      return "no_account";
    }

    // ══════════════════════════════════════════════════════════
    // 调用 Runway API
    // ══════════════════════════════════════════════════════════

    const { remoteTaskId } = await client.createTask({
      prompt:      dbJob.prompt,
      mode:        dbJob.mode as any,
      imageUrl:    dbJob.imageUrl || undefined,
      imageUrls,
      duration:    dbJob.duration || 5,
      exploreMode: dbJob.exploreMode ?? true,
      modelName:   "kling_3_0_pro",
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
    console.log(`[submit-worker] ✓ jobId=${jobId.slice(0,8)} -> processing, remote=${remoteTaskId.slice(0,8)}, account=${account.label}`);

    // 记录本次使用的账号（供 worker handler 做批次计数）
    await connection.set("submit:last-account-id", account.id, "EX", 300);
    await connection.set("submit:last-account-label", account.label, "EX", 300);

    // 加入轮询队列（带重试）
    let pollAdded = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await pollQueue.add("poll", {
          jobId, remoteTaskId, accountId: account.id,
        }, { jobId: `poll-${jobId}-${Date.now()}`, delay: 15000 });
        pollAdded = true;
        break;
      } catch (pollErr: any) {
        console.error(`[submit-worker] pollQueue.add attempt ${attempt}/3 failed: ${pollErr.message}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 1000));
      }
    }
    if (!pollAdded) {
      console.error(`[submit-worker] pollQueue.add failed 3x, leaving ${jobId.slice(0,8)} in processing for recovery`);
    }

    return "submitted";

  } catch (err: any) {
    const msg = err.message || String(err);
    console.error(`[submit-worker] jobId=${jobId.slice(0,8)} error: ${msg.slice(0, 120)}`);

    const isNetworkError = /socket hang up|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|EAI_AGAIN|network|fetch failed|abort|aborted/i.test(msg);

    if (msg === "RATE_LIMITED") {
      await accountPool.release(account.id);
      await accountPool.recordError(account.id, "429 Rate Limited");
      await accountPool.setCooldown(account.id, 420);
      await connection.set("global:rate-limit-cooldown", "1", "EX", 180);
      await prisma.runwayJob.update({ where: { id: jobId }, data: { status: "pending", accountId: null, startedAt: null } as any });
      return "rate_limited";
    }

    if (isNetworkError) {
      await accountPool.release(account.id);
      await accountPool.recordError(account.id, msg.slice(0, 200));
      await prisma.runwayJob.update({ where: { id: jobId }, data: { status: "pending", accountId: null, errorMessage: '网络错误(将重试)' } as any });
      return "network_error";
    }

    // 永久失败
    await accountPool.release(account.id, jobId);
    await accountPool.recordError(account.id, msg);
    await prisma.runwayJob.update({
      where: { id: jobId },
      data: { status: "failed", errorMessage: msg.slice(0, 500), finishedAt: new Date() },
    });
    return "job_failed";
  }
}

// ═══════════════════════════════════════════════════════════════
// Worker 主处理器
// ═══════════════════════════════════════════════════════════════

new Worker("runway-submit", async (job: Job) => {
  const result = await trySubmitOne();

  switch (result) {
    case "submitted": {
      // 批次计数+检查（per-account）
      // 从最近提交的任务中获取 accountId
      // trySubmitOne 不返回 accountId，但我们可以从 Redis 获取最近使用的账号
      // 更简洁的做法：在 trySubmitOne 里记录
      const lastAccountId = await connection.get("submit:last-account-id");
      const lastAccountLabel = await connection.get("submit:last-account-label") || "?";
      if (lastAccountId) {
        const needRest = await incrementBatchAndCheck(lastAccountId, lastAccountLabel);
        if (needRest) {
          await startBatchRest(lastAccountId, lastAccountLabel);
        }
      }
      // 无论是否休息，都尝试下一个（可能另一个账号没在休息）
      const d = randInt(POST_SUBMIT_DELAY_MIN, POST_SUBMIT_DELAY_MAX + 1);
      console.log(`[submit-worker] submitted OK, next in ${(d/1000).toFixed(0)}s`);
      await triggerSubmit(d);
      return;
    }

    case "job_failed":
      await triggerSubmit(10000);
      return;

    case "network_error":
      await triggerSubmit(randInt(NETWORK_RETRY_MIN, NETWORK_RETRY_MAX + 1));
      return;

    case "rate_limited":
      // 不自行调度 — cooldown 到期后由 safety net 触发
      console.log(`[submit-worker] rate limited, waiting for cooldown to expire`);
      return;

    case "batch_resting": {
      // 找到最短的休息剩余时间，预约唤醒
      const accounts = await accountPool.getAccounts();
      let minTtl = 999999;
      for (const acct of accounts) {
        const ttl = await connection.ttl(`submit:batch-resting:${acct.id}`);
        if (ttl > 0 && ttl < minTtl) minTtl = ttl;
      }
      if (minTtl < 999999) {
        const wakeDelay = (minTtl + 10) * 1000; // wake 10s after shortest rest expires
        console.log(`[submit-worker] all accounts resting, wake in ${Math.ceil(wakeDelay/60000)}min`);
        await triggerSubmit(wakeDelay);
      }
      return;
    }

    case "no_account":
      // 所有账号满了 — 等 poll 释放槽位后触发
      console.log(`[submit-worker] all accounts full, waiting for poll to free a slot`);
      return;

    case "no_pending":
      console.log(`[submit-worker] no pending jobs`);
      return;
  }
}, {
  connection,
  concurrency: 1,
});

// ═══════════════════════════════════════════════════════════════
// Safety Net（兜底检查，每2分钟）
// 条件：有待处理任务 + 不在冷却/休息中 + 有空闲账号 + 无排队触发器
// ═══════════════════════════════════════════════════════════════

setInterval(async () => {
  try {
    const pendingCount = await prisma.runwayJob.count({ where: { status: "pending" } });
    if (pendingCount === 0) return;

    // 所有账号都在批次休息中不触发
    if (await areAllAccountsResting()) return;

    // 冷却中不触发
    const cooldown = await connection.get("global:rate-limit-cooldown");
    if (cooldown) return;

    // 检查是否有账号在 DB 层有空位（排除休息中的账号）
    const accounts = await accountPool.getAccounts();
    let hasSlot = false;
    for (const acct of accounts) {
      if (await isAccountBatchResting(acct.id)) continue;
      const dbActive = await prisma.runwayJob.count({
        where: {
          accountId: acct.id,
          status: { in: ["submitted", "processing"] },
          remoteTaskId: { not: null },
        },
      });
      if (dbActive < acct.maxConcurrency) {
        hasSlot = true;
        break;
      }
    }
    if (!hasSlot) return;

    // 已有触发器排队就不重复
    const existing = await submitQueue.getJob("submit-next");
    if (existing) {
      const state = await existing.getState();
      if (state === "delayed" || state === "waiting" || state === "active") return;
    }
    // Also check if there's an active worker processing right now
    const activeCount = await submitQueue.getActiveCount();
    if (activeCount > 0) return;

    console.log(`[safety-net] ${pendingCount} pending, slot available, no trigger — firing`);
    await triggerSubmit(10000);
  } catch (e: any) {
    console.warn("[safety-net] error:", e.message);
  }
}, SAFETY_NET_INTERVAL);

console.log("[submit-worker] listening (per-account concurrency + batch rest + 2min safety net)");
