import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";
import { prisma, redis } from "../services/shared";

const DISPATCH_ENABLED_KEY = "borrow:dispatch:enabled";
const DISPATCH_MAX_GLOBAL_KEY = "borrow:dispatch:max-global";
const DISPATCH_PENDING_THRESHOLD_KEY = "borrow:dispatch:pending-threshold";
const DISPATCH_USAGE_THRESHOLD_KEY = "borrow:dispatch:local-usage-threshold";
const DISPATCH_COOLDOWN_KEY = "borrow:dispatch:cooldown";
const DISPATCH_FAILURE_KEY = "borrow:dispatch:failure-count";
const DISPATCH_INTERVAL_MS = Number(process.env.BORROW_DISPATCH_INTERVAL_MS) || 15000;
const POLL_INTERVAL_MS = Number(process.env.BORROW_POLL_INTERVAL_MS) || 20000;
const FETCH_TIMEOUT_MS = Number(process.env.BORROW_FETCH_TIMEOUT_MS) || 15000;
const REMOTE_NO_TASK_STALE_MINUTES = Math.max(3, Number(process.env.BORROW_REMOTE_NO_TASK_STALE_MINUTES) || 10);

const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled", "deleted"]);

type BorrowSystem = {
  id: string;
  name: string;
  endpoint: string;
  maxInflight: number;
};

function toInt(value: string | null | undefined, fallback: number, min = 0, max = 10000): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

async function fetchJson(url: string, init: any): Promise<any> {
  const timeout = new Promise((_resolve, reject) => setTimeout(() => reject(new Error(`timeout ${FETCH_TIMEOUT_MS}ms`)), FETCH_TIMEOUT_MS));
  const response: any = await Promise.race([fetch(url, init), timeout]);
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) {
    throw new Error(body?.error || `${response.status} ${response.statusText}`);
  }
  return body;
}

function parseImages(raw: any): string[] | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : undefined;
  } catch { return undefined; }
}

function sourceBase(): string {
  return String(
    process.env.BORROW_SOURCE_BASE ||
    process.env.BORROW_PUBLIC_BASE ||
    process.env.WEB_BASE ||
    process.env.PUBLIC_BASE_URL ||
    "",
  ).replace(/\/$/, "");
}

function absoluteSourceUrl(value?: string | null): string | null {
  if (!value) return null;
  const raw = String(value);
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!raw.startsWith("/")) return raw;
  const base = sourceBase();
  if (!base) {
    console.warn(`[borrow] relative asset URL without BORROW_SOURCE_BASE: ${raw}`);
    return raw;
  }
  return `${base}${raw}`;
}

function absoluteSourceUrls(values?: string[]): string[] | undefined {
  if (!values) return undefined;
  return values.map((v) => absoluteSourceUrl(v)).filter(Boolean) as string[];
}

async function getSettings() {
  const [enabled, maxGlobal, pendingThreshold, usageThreshold] = await Promise.all([
    redis.get(DISPATCH_ENABLED_KEY),
    redis.get(DISPATCH_MAX_GLOBAL_KEY),
    redis.get(DISPATCH_PENDING_THRESHOLD_KEY),
    redis.get(DISPATCH_USAGE_THRESHOLD_KEY),
  ]);
  return {
    enabled: enabled === "1" || process.env.BORROW_DISPATCH_ENABLED === "1",
    maxGlobal: toInt(maxGlobal, Number(process.env.BORROW_DISPATCH_MAX_GLOBAL) || 4, 1, 100),
    pendingThreshold: toInt(pendingThreshold, Number(process.env.BORROW_DISPATCH_PENDING_THRESHOLD) || 20, 1, 10000),
    usageThreshold: toInt(usageThreshold, Number(process.env.BORROW_DISPATCH_USAGE_THRESHOLD) || 70, 0, 100),
  };
}

async function getLocalUsagePercent(): Promise<number> {
  const accounts = await prisma.runwayAccount.findMany({ where: { isActive: true }, select: { id: true, maxConcurrency: true } });
  let total = 0;
  let used = 0;
  for (const account of accounts) {
    total += account.maxConcurrency || 0;
    const current = await redis.get(`account:concurrency:${account.id}`);
    used += current ? Math.max(0, Number(current) || 0) : 0;
  }
  if (total <= 0) return 0;
  return Math.round((used / total) * 100);
}

async function getSystems(): Promise<BorrowSystem[]> {
  const rows: any[] = await (prisma as any).$queryRawUnsafe(`
    SELECT id::text, name, endpoint, max_inflight AS "maxInflight"
    FROM borrow_systems
    WHERE enabled = true
    ORDER BY priority DESC, created_at ASC
  `);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    endpoint: String(r.endpoint || "").replace(/\/$/, ""),
    maxInflight: Math.max(1, Number(r.maxInflight) || 1),
  })).filter((s) => s.endpoint);
}

async function refreshCapacity(system: BorrowSystem): Promise<number> {
  try {
    const cap = await fetchJson(`${system.endpoint}/api/runway/borrow/capacity`, {
      method: "GET",
      headers: {},
    });
    await (prisma as any).$executeRawUnsafe(`
      INSERT INTO borrow_capacity_reports (system_id, reported_at, local_pending, local_active, free_slots, available_slots, cooldown_accounts, recent_429, failure_rate, avg_duration_seconds, raw_json)
      VALUES ($1::uuid, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
      ON CONFLICT (system_id) DO UPDATE SET
        reported_at = excluded.reported_at,
        local_pending = excluded.local_pending,
        local_active = excluded.local_active,
        free_slots = excluded.free_slots,
        available_slots = excluded.available_slots,
        cooldown_accounts = excluded.cooldown_accounts,
        recent_429 = excluded.recent_429,
        failure_rate = excluded.failure_rate,
        avg_duration_seconds = excluded.avg_duration_seconds,
        raw_json = excluded.raw_json
    `,
      system.id,
      Number(cap.localPending) || 0,
      Number(cap.localActive) || 0,
      Number(cap.freeSlots) || 0,
      Number(cap.availableSlots) || 0,
      Number(cap.cooldownAccounts) || 0,
      Number(cap.recent429) || 0,
      Number(cap.failureRate) || 0,
      cap.avgDurationSeconds == null ? null : Number(cap.avgDurationSeconds),
      JSON.stringify(cap),
    );
    return Math.max(0, Number(cap.availableSlots) || 0);
  } catch (e: any) {
    console.warn(`[borrow] capacity ${system.name} failed: ${e.message}`);
    await (prisma as any).$executeRawUnsafe(`
      INSERT INTO borrow_capacity_reports (system_id, reported_at, available_slots, raw_json)
      VALUES ($1::uuid, now(), 0, $2::jsonb)
      ON CONFLICT (system_id) DO UPDATE SET reported_at = excluded.reported_at, available_slots = 0, raw_json = excluded.raw_json
    `, system.id, JSON.stringify({ error: e.message }));
    return 0;
  }
}

async function getInflightBySystem(): Promise<Record<string, number>> {
  const rows: any[] = await (prisma as any).$queryRawUnsafe(`
    SELECT system_id::text AS "systemId", COUNT(*)::int AS count
    FROM borrow_dispatches
    WHERE status IN ('dispatching','accepted','processing') AND system_id IS NOT NULL
    GROUP BY system_id
  `);
  const map: Record<string, number> = {};
  for (const row of rows) map[row.systemId] = Number(row.count) || 0;
  return map;
}

function buildPayload(job: any, dispatchId: string) {
  const imageUrls = absoluteSourceUrls(parseImages(job.referenceImages));
  return {
    dispatchId,
    jobId: job.id,
    prompt: job.prompt,
    mode: job.mode,
    imageUrl: absoluteSourceUrl(job.imageUrl),
    imageUrls,
    referenceImages: imageUrls ? JSON.stringify(imageUrls) : job.referenceImages,
    duration: job.duration,
    exploreMode: job.exploreMode,
    modelName: job.modelName,
    remark: job.remark,
    resolution: job.resolution,
    quality: job.quality,
    cfgScale: job.cfgScale,
    sound: job.sound,
    videoUrl: absoluteSourceUrl(job.videoUrl),
  };
}

async function releaseToLocal(jobId: string, dispatchId: string, errorCode: string, message: string) {
  await (prisma as any).$executeRawUnsafe(`
    UPDATE runway_jobs
    SET status = 'pending', execution_mode = 'local', borrow_dispatch_id = NULL, borrow_system_id = NULL,
        borrow_system_name = NULL, borrow_status = 'failed', borrow_error_code = $3,
        error_message = NULL, account_id = NULL, remote_task_id = NULL, started_at = NULL,
        progress = 0, updated_at = now()
    WHERE id = $1::uuid AND borrow_dispatch_id = $2::uuid
  `, jobId, dispatchId, errorCode);
  await (prisma as any).$executeRawUnsafe(`
    UPDATE borrow_dispatches SET status = 'failed', error_code = $2, error_message = $3, updated_at = now()
    WHERE id = $1::uuid
  `, dispatchId, errorCode, message.slice(0, 1000));
  console.warn(`[borrow] dispatch ${dispatchId.slice(0, 8)} returned to local queue: ${message.slice(0, 120)}`);
}

async function dispatchOne(system: BorrowSystem, job: any) {
  const dispatchId = uuidv4();
  const updated = await (prisma as any).$executeRawUnsafe(`
    UPDATE runway_jobs
    SET status = 'processing', execution_mode = 'borrowed', borrow_dispatch_id = $2::uuid,
        borrow_system_id = $3::uuid, borrow_system_name = $4, borrow_status = 'dispatching',
        started_at = COALESCE(started_at, now()), updated_at = now()
    WHERE id = $1::uuid
      AND status IN ('pending','queued')
      AND COALESCE(execution_mode, 'local') = 'local'
      AND provider <> 'borrowed'
  `, job.id, dispatchId, system.id, system.name);
  if (Number(updated) !== 1) return false;

  const payload = buildPayload(job, dispatchId);
  await (prisma as any).$executeRawUnsafe(`
    INSERT INTO borrow_dispatches (id, runway_job_id, system_id, system_name, status, payload_json, attempt, created_at, updated_at)
    VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'dispatching', $5::jsonb, 1, now(), now())
  `, dispatchId, job.id, system.id, system.name, JSON.stringify(payload));

  try {
    const accepted = await fetchJson(`${system.endpoint}/api/runway/borrow/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    await (prisma as any).$executeRawUnsafe(`
      UPDATE borrow_dispatches
      SET status = 'accepted', shadow_job_id = $2, last_heartbeat_at = now(), updated_at = now()
      WHERE id = $1::uuid
    `, dispatchId, accepted.shadowJobId || null);
    await (prisma as any).$executeRawUnsafe(`
      UPDATE runway_jobs SET borrow_status = 'accepted', updated_at = now() WHERE id = $1::uuid
    `, job.id);
    console.log(`[borrow] ${job.id.slice(0, 8)} dispatched to ${system.name} (${dispatchId.slice(0, 8)})`);
    return true;
  } catch (e: any) {
    await releaseToLocal(job.id, dispatchId, "dispatch_failed", e.message || String(e));
    const failCount = await redis.incr(DISPATCH_FAILURE_KEY);
    if (failCount === 1) await redis.expire(DISPATCH_FAILURE_KEY, 300);
    if (failCount >= 6) {
      await redis.set(DISPATCH_COOLDOWN_KEY, "1", "EX", 120);
      console.warn("[borrow] global dispatch cooldown enabled for 120s after repeated child failures");
    }
    return false;
  }
}

async function dispatchTick() {
  const settings = await getSettings();
  if (!settings.enabled) return;
  if (await redis.get(DISPATCH_COOLDOWN_KEY)) return;

  const [pendingCount, activeGlobal, usagePercent] = await Promise.all([
    prisma.runwayJob.count({ where: { provider: { not: "borrowed" }, status: { in: ["pending", "queued"] } } as any }),
    (prisma as any).$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM borrow_dispatches WHERE status IN ('dispatching','accepted','processing')`),
    getLocalUsagePercent(),
  ]);
  if (pendingCount < settings.pendingThreshold) return;
  if (settings.usageThreshold > 0 && usagePercent < settings.usageThreshold) return;

  const globalInFlight = Number((activeGlobal as any[])[0]?.count || 0);
  const remainingGlobal = Math.max(0, settings.maxGlobal - globalInFlight);
  if (remainingGlobal <= 0) return;

  const systems = await getSystems();
  if (systems.length === 0) return;
  const inflightBySystem = await getInflightBySystem();
  const slots: BorrowSystem[] = [];
  for (const system of systems) {
    const available = await refreshCapacity(system);
    const already = inflightBySystem[system.id] || 0;
    const usable = Math.max(0, Math.min(system.maxInflight - already, available));
    for (let i = 0; i < usable; i++) slots.push(system);
  }
  const take = Math.min(remainingGlobal, slots.length);
  if (take <= 0) return;

  const jobs: any[] = await (prisma as any).$queryRawUnsafe(`
    SELECT id::text, prompt, mode, image_url AS "imageUrl", reference_images AS "referenceImages",
           duration, explore_mode AS "exploreMode", model_name AS "modelName", remark,
           resolution, quality, cfg_scale AS "cfgScale", sound, video_url AS "videoUrl"
    FROM runway_jobs
    WHERE status IN ('pending','queued')
      AND COALESCE(execution_mode, 'local') = 'local'
      AND provider <> 'borrowed'
    ORDER BY priority DESC, created_at ASC
    LIMIT $1
  `, take);

  for (let i = 0; i < jobs.length; i++) {
    await dispatchOne(slots[i], jobs[i]);
  }
}

async function pollTick() {
  // Polling must continue when dispatch is disabled so already-borrowed jobs can finish and return to the main task cards.
  const rows: any[] = await (prisma as any).$queryRawUnsafe(`
    SELECT bd.id::text, bd.runway_job_id::text AS "jobId", bd.system_name AS "systemName",
           bs.endpoint, bd.updated_at AS "updatedAt"
    FROM borrow_dispatches bd
    JOIN borrow_systems bs ON bs.id = bd.system_id
    WHERE bd.status IN ('dispatching','accepted','processing')
    ORDER BY bd.updated_at ASC
    LIMIT 30
  `);
  for (const row of rows) {
    try {
      const remote = await fetchJson(`${String(row.endpoint).replace(/\/$/, "")}/api/runway/borrow/jobs/${row.id}`, {
        method: "GET",
        headers: {},
      });
      const status = String(remote.status || "processing");
      const remoteUpdatedAt = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
      const remoteStaleMinutes = remoteUpdatedAt > 0 ? (Date.now() - remoteUpdatedAt) / 60000 : 0;
      const remoteHasNoTask = !remote.remoteTaskId;
      if (remoteHasNoTask && ["pending", "queued", "submitted", "processing"].includes(status) && remoteStaleMinutes >= REMOTE_NO_TASK_STALE_MINUTES) {
        await releaseToLocal(row.jobId, row.id, "remote_no_task_stale", `child ${row.systemName} stayed ${status} without remote task for ${remoteStaleMinutes.toFixed(1)} minutes`);
        continue;
      }
      if (status === "completed") {
        await (prisma as any).$executeRawUnsafe(`
          UPDATE runway_jobs
          SET status = 'completed', result_url = $2, thumbnail_url = $3, video_url = $4,
              progress = 1, finished_at = COALESCE(finished_at, now()), borrow_status = 'completed', updated_at = now()
          WHERE id = $1::uuid AND borrow_dispatch_id = $5::uuid
        `, row.jobId, remote.resultUrl || null, remote.thumbnailUrl || null, remote.videoUrl || remote.resultUrl || null, row.id);
        await (prisma as any).$executeRawUnsafe(`
          UPDATE borrow_dispatches
          SET status = 'completed', result_url = $2, thumbnail_url = $3, video_url = $4,
              last_heartbeat_at = now(), updated_at = now()
          WHERE id = $1::uuid
        `, row.id, remote.resultUrl || null, remote.thumbnailUrl || null, remote.videoUrl || remote.resultUrl || null);
        console.log(`[borrow] ${String(row.jobId).slice(0, 8)} completed by ${row.systemName}`);
        continue;
      }
      if (TERMINAL_JOB_STATUSES.has(status)) {
        await releaseToLocal(row.jobId, row.id, status, remote.errorMessage || `borrow shadow ended with ${status}`);
        continue;
      }
      await (prisma as any).$executeRawUnsafe(`
        UPDATE borrow_dispatches SET status = 'processing', last_heartbeat_at = now(), updated_at = now() WHERE id = $1::uuid
      `, row.id);
      await (prisma as any).$executeRawUnsafe(`
        UPDATE runway_jobs SET borrow_status = $2, progress = GREATEST(COALESCE(progress,0), $3), updated_at = now()
        WHERE id = $1::uuid AND borrow_dispatch_id = $4::uuid
      `, row.jobId, status, Math.max(0, Math.min(0.99, Number(remote.progress) || 0)), row.id);
    } catch (e: any) {
      const ageMinutes = (Date.now() - new Date(row.updatedAt).getTime()) / 60000;
      if (ageMinutes > 15) {
        await releaseToLocal(row.jobId, row.id, "poll_timeout", e.message || String(e));
      } else {
        console.warn(`[borrow] poll ${String(row.id).slice(0, 8)} failed: ${e.message}`);
      }
    }
  }
}

function schedule(name: string, fn: () => Promise<void>, intervalMs: number, firstDelayMs: number) {
  const run = async () => {
    try { await fn(); }
    catch (e: any) { console.warn(`[borrow:${name}]`, e?.message || e); }
  };
  setTimeout(run, firstDelayMs);
  setInterval(run, intervalMs);
}

schedule("dispatch", dispatchTick, DISPATCH_INTERVAL_MS, 25000);
schedule("poll", pollTick, POLL_INTERVAL_MS, 30000);
console.log("[borrow] dispatcher loaded (disabled unless borrow:dispatch:enabled=1)");
