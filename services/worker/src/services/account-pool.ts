import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';

export interface AccountEntry {
  id: string;
  label: string;
  token: string;
  tokenShort: string;
  teamId: string;
  proxyUrl: string | null;
  maxConcurrency: number;
  priority: number;
  tokenExpiresAt: Date | null;
  lastUsedAt: Date | null;
}

const CACHE_TTL = 30; // seconds to cache account list
const CONCURRENCY_TTL = 900; // seconds for concurrency key safety TTL (15 min)
const SAFETY_FAILURE_DAILY_LIMIT = Math.max(1, Number(process.env.RUNWAY_SAFETY_FAILURE_DAILY_LIMIT) || 3);
const SAFETY_FAILURE_WINDOW_SECONDS = Math.max(300, Number(process.env.RUNWAY_SAFETY_FAILURE_WINDOW_SECONDS) || 24 * 60 * 60);
const CONTENT_REVIEW_KEY = "runway:content-review-enabled";

export function isRunwayTokenRevokedError(message: string): boolean {
  return /(?:\b401\b|unauthorized|token.*(?:revoked|expired|invalid)|jwt expired|invalid token|token revoked)/i.test(message || '');
}

export function isRunwaySafetyError(message: string): boolean {
  return /(?:SAFETY\.|failureCode|moderation|content policy|risk control|SEXUALLY_EXPLICIT|VIOLENCE|prohibited|safety checker|内容审核|未通过审核|暴力|色情|安全)/i.test(message || '');
}

export class AccountPool {
  private redis: IORedis;
  private prisma: PrismaClient;
  private cachedAccounts: AccountEntry[] = [];
  private cacheExpiry = 0;

  // Lua: atomic INCR-if-below-max, returns current count or -1 if full
  private readonly ACQUIRE_LUA = `
    local key = KEYS[1]
    local max = tonumber(ARGV[1])
    local ttl = tonumber(ARGV[2])
    local cur = redis.call('INCR', key)
    if cur <= max then
      redis.call('EXPIRE', key, ttl)
      return cur
    else
      redis.call('DECR', key)
      return -1
    end
  `;

  constructor(redis: IORedis, prisma: PrismaClient) {
    this.redis = redis;
    this.prisma = prisma;
  }

  /** Load active accounts from DB, cached for CACHE_TTL seconds */
  async getAccounts(): Promise<AccountEntry[]> {
    const now = Date.now();
    if (this.cachedAccounts.length > 0 && now < this.cacheExpiry) {
      return this.cachedAccounts;
    }

    const rows = await this.prisma.runwayAccount.findMany({
      where: { isActive: true },
      orderBy: [{ priority: 'desc' }, { lastUsedAt: { sort: 'asc', nulls: 'first' } }],
    });

    this.cachedAccounts = rows.map(r => ({
      id: r.id,
      label: r.label,
      token: r.token,
      tokenShort: r.tokenShort,
      teamId: r.teamId,
      proxyUrl: r.proxyUrl,
      maxConcurrency: r.maxConcurrency,
      priority: r.priority,
      tokenExpiresAt: r.tokenExpiresAt,
      lastUsedAt: r.lastUsedAt,
    }));
    this.cacheExpiry = now + CACHE_TTL * 1000;

    if (this.cachedAccounts.length === 0) {
      console.warn('[account-pool] no active accounts found in database');
    } else {
      console.log(`[account-pool] loaded ${this.cachedAccounts.length} account(s)`);
    }

    return this.cachedAccounts;
  }

  /** Invalidate cache so next getAccounts() re-reads from DB */
  invalidateCache(): void {
    this.cacheExpiry = 0;
  }

  /**
   * Acquire an account with available concurrency.
   * No cooldown — just check concurrency slots.
   * Returns the account entry or null if all accounts are at max concurrency.
   */
  async acquire(): Promise<AccountEntry | null> {
    const accounts = await this.getAccounts();
    const now = Date.now();

    for (const account of accounts) {
      if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < now) {
        console.warn(`[account-pool] ${account.label} token expired, skipping`);
        continue;
      }

      // Atomic: INCR only if below max (Lua script, no race condition)
      const key = `account:concurrency:${account.id}`;
      const result = await this.redis.eval(
        this.ACQUIRE_LUA, 1, key,
        String(account.maxConcurrency), String(CONCURRENCY_TTL)
      ) as number;

      if (result > 0) {
        console.log(`[account-pool] acquired ${account.label} (${result}/${account.maxConcurrency})`);
        this.prisma.runwayAccount.update({
          where: { id: account.id },
          data: { lastUsedAt: new Date() },
        }).catch(() => {});
        return account;
      }
    }

    return null;
  }


  /**
   * Acquire an account excluding a specific accountId.
   * Used when retrying a job that failed/timed-out on a specific account.
   */
  async acquireExcluding(excludeId: string): Promise<AccountEntry | null> {
    const accounts = await this.getAccounts();
    const now = Date.now();

    for (const account of accounts) {
      if (account.id === excludeId) continue;
      if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < now) continue;

      const key = `account:concurrency:${account.id}`;
      const result = await this.redis.eval(
        this.ACQUIRE_LUA, 1, key,
        String(account.maxConcurrency), String(CONCURRENCY_TTL)
      ) as number;

      if (result > 0) {
        console.log(`[account-pool] acquired (excluding ${excludeId.slice(0,8)}) ${account.label} (${result}/${account.maxConcurrency})`);
        this.prisma.runwayAccount.update({
          where: { id: account.id },
          data: { lastUsedAt: new Date() },
        }).catch(() => {});
        return account;
      }
    }

    return null;
  }

  /**
   * Smart acquire: reconcile Redis with DB first, then acquire.
   * This prevents ghost concurrency slots from blocking new jobs.
   */
  private dbActiveCache: Map<string, { count: number; ts: number }> = new Map();
  private readonly DB_CACHE_TTL = 5000; // 5 seconds

  private async getDbActive(accountId: string): Promise<number> {
    const cached = this.dbActiveCache.get(accountId);
    if (cached && Date.now() - cached.ts < this.DB_CACHE_TTL) return cached.count;
    const count = await this.prisma.runwayJob.count({
      where: { accountId, status: { in: ['submitted', 'processing'] } },
    });
    this.dbActiveCache.set(accountId, { count, ts: Date.now() });
    return count;
  }

  /** Invalidate DB active cache */
  invalidateDbCache(): void {
    this.dbActiveCache.clear();
  }

  /** Build load-balanced candidate list: filter unavailable, sort by least-loaded (free slots desc, then concurrency ratio asc, then lastUsedAt asc) */
  private async buildCandidates(accounts: AccountEntry[], excludeId?: string): Promise<AccountEntry[]> {
    const now = Date.now();
    const eligible: Array<{ acct: AccountEntry; cur: number; free: number; ratio: number }> = [];
    for (const account of accounts) {
      if (excludeId && account.id === excludeId) continue;
      if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < now) continue;
      const inCooldown = await this.redis.get(`account:cooldown:${account.id}`);
      if (inCooldown) continue;
      const curStr = await this.redis.get(`account:concurrency:${account.id}`);
      const cur = curStr ? parseInt(curStr, 10) : 0;
      if (cur >= account.maxConcurrency) continue; // already full, skip
      const free = account.maxConcurrency - cur;
      const ratio = cur / account.maxConcurrency;
      eligible.push({ acct: account, cur, free, ratio });
    }
    // least-loaded first: more free slots wins; tiebreak by lower ratio, then older lastUsedAt
    eligible.sort((a, b) => {
      if (b.free !== a.free) return b.free - a.free;
      if (a.ratio !== b.ratio) return a.ratio - b.ratio;
      const aT = a.acct.lastUsedAt ? a.acct.lastUsedAt.getTime() : 0;
      const bT = b.acct.lastUsedAt ? b.acct.lastUsedAt.getTime() : 0;
      return aT - bT;
    });
    return eligible.map(e => e.acct);
  }

  /**
   * Acquire a slot on a SPECIFIC account (for per-account submit loops).
   * Does NOT check cooldown — caller is responsible for that so it can wait properly.
   */
  async acquireSpecific(accountId: string): Promise<AccountEntry | null> {
    const accounts = await this.getAccounts();
    const account = accounts.find(a => a.id === accountId);
    if (!account) return null;
    const now = Date.now();
    if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < now) return null;
    const key = `account:concurrency:${account.id}`;
    const result = await this.redis.eval(
      this.ACQUIRE_LUA, 1, key,
      String(account.maxConcurrency), String(CONCURRENCY_TTL)
    ) as number;
    if (result > 0) {
      console.log(`[account-pool] acquireSpecific ${account.label} (redis=${result}/${account.maxConcurrency})`);
      this.prisma.runwayAccount.update({
        where: { id: account.id },
        data: { lastUsedAt: new Date() },
      }).catch(() => {});
      const cached = this.cachedAccounts.find(a => a.id === account.id);
      if (cached) cached.lastUsedAt = new Date();
      return account;
    }
    return null;
  }

  async smartAcquire(): Promise<AccountEntry | null> {
    const accounts = await this.getAccounts();
    const candidates = await this.buildCandidates(accounts);

    for (const account of candidates) {
      // Atomic INCR-if-below-max (Lua) — still required to prevent race with concurrent workers
      const key = `account:concurrency:${account.id}`;
      const result = await this.redis.eval(
        this.ACQUIRE_LUA, 1, key,
        String(account.maxConcurrency), String(CONCURRENCY_TTL)
      ) as number;

      if (result > 0) {
        console.log(`[account-pool] smart-acquired ${account.label} (redis=${result}/${account.maxConcurrency}) [balanced]`);
        this.prisma.runwayAccount.update({
          where: { id: account.id },
          data: { lastUsedAt: new Date() },
        }).catch(() => {});
        // Update in-memory cached lastUsedAt so subsequent acquires within cache TTL see fresh order
        const cached = this.cachedAccounts.find(a => a.id === account.id);
        if (cached) cached.lastUsedAt = new Date();
        return account;
      }
    }

    return null;
  }

  /**
   * Smart acquireExcluding: reconcile + exclude specific account.
   */
  async smartAcquireExcluding(excludeId: string): Promise<AccountEntry | null> {
    const accounts = await this.getAccounts();
    const candidates = await this.buildCandidates(accounts, excludeId);

    for (const account of candidates) {
      const key = `account:concurrency:${account.id}`;
      const result = await this.redis.eval(
        this.ACQUIRE_LUA, 1, key,
        String(account.maxConcurrency), String(CONCURRENCY_TTL)
      ) as number;

      if (result > 0) {
        console.log(`[account-pool] smart-acquired (excl ${excludeId.slice(0,8)}) ${account.label} (redis=${result}/${account.maxConcurrency}) [balanced]`);
        this.prisma.runwayAccount.update({
          where: { id: account.id },
          data: { lastUsedAt: new Date() },
        }).catch(() => {});
        const cached = this.cachedAccounts.find(a => a.id === account.id);
        if (cached) cached.lastUsedAt = new Date();
        return account;
      }
    }

    return null;
  }


  /** Put an account in cooldown (rate-limited) */
  async setCooldown(accountId: string, seconds: number = 60): Promise<void> {
    const key = `account:cooldown:${accountId}`;
    await this.redis.set(key, '1', 'EX', seconds);
    console.log(`[account-pool] ${accountId.slice(0,8)} in cooldown for ${seconds}s`);
  }
  /** Release a concurrency slot for an account (idempotent per accountId+jobId) */
  async release(accountId: string, jobId?: string): Promise<void> {
    // Prevent double-release for the same account+job combination
    if (jobId) {
      const releaseKey = `account:released:${accountId}:${jobId}`;
      const alreadyReleased = await this.redis.set(releaseKey, '1', 'EX', 600, 'NX');
      if (!alreadyReleased) {
        console.log(`[account-pool] already released ${accountId.slice(0, 8)} for job ${jobId.slice(0, 8)}, skipping`);
        return;
      }
    }

    const key = `account:concurrency:${accountId}`;
    const val = await this.redis.decr(key);
    // Prevent going negative
    if (val < 0) {
      await this.redis.set(key, '0');
    }
    console.log(`[account-pool] released ${accountId.slice(0, 8)}, now ${Math.max(0, val)}`);
  }
  /** Release a concurrency slot without a jobId (for slots acquired but never used for a job).
   *  Uses a per-invocation nonce to prevent double-release within the same flow. */
  async releaseNoJob(accountId: string): Promise<void> {
    const key = `account:concurrency:${accountId}`;
    const val = await this.redis.decr(key);
    if (val < 0) {
      await this.redis.set(key, '0');
    }
    console.log(`[account-pool] released (no-job) ${accountId.slice(0, 8)}, now ${Math.max(0, val)}`);
  }


  /** Record an error on an account */
  async recordError(accountId: string, message: string): Promise<void> {
    const clipped = String(message || '').slice(0, 500);
    await this.prisma.runwayAccount.update({
      where: { id: accountId },
      data: { lastErrorAt: new Date(), lastErrorMessage: clipped },
    }).catch(() => {});
  }

  /** Disable an account immediately when the token is revoked or risk is too high. */
  async disableAccount(accountId: string, reason: string): Promise<void> {
    const clipped = String(reason || 'auto-disabled by risk control').slice(0, 500);
    await this.prisma.runwayAccount.update({
      where: { id: accountId },
      data: { isActive: false, lastErrorAt: new Date(), lastErrorMessage: clipped },
    }).catch(() => {});
    await this.redis.del(
      `account:concurrency:${accountId}`,
      `account:cooldown:${accountId}`,
      `submit:batch-resting:${accountId}`,
      `submit:batch-count:${accountId}`,
      `submit:batch-limit:${accountId}`,
    ).catch(() => {});
    this.cachedAccounts = this.cachedAccounts.filter(a => a.id !== accountId);
    this.invalidateCache();
    this.invalidateDbCache();
    console.warn(`[account-pool] auto-disabled ${accountId.slice(0,8)}: ${clipped}`);
  }

  /** Track content-safety failures and disable the account after a rolling-window limit. */
  async recordSafetyFailure(accountId: string, message: string): Promise<number> {
    await this.recordError(accountId, message);
    const key = `account:safety-failures:${accountId}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, SAFETY_FAILURE_WINDOW_SECONDS);
    }
    if (count >= SAFETY_FAILURE_DAILY_LIMIT) {
      await this.disableAccount(
        accountId,
        `auto-disabled after ${count} safety failures in ${Math.round(SAFETY_FAILURE_WINDOW_SECONDS / 3600)}h: ${String(message || '').slice(0, 220)}`,
      );
    } else {
      console.warn(`[account-pool] safety failure ${count}/${SAFETY_FAILURE_DAILY_LIMIT} for ${accountId.slice(0,8)}`);
    }
    return count;
  }

  private async isContentReviewEnabled(): Promise<boolean> {
    const raw = await this.redis.get(CONTENT_REVIEW_KEY).catch(() => null);
    return raw === null ? true : raw === '1';
  }

  /** Classify high-risk upstream errors and apply account-level protection. */
  async handleRiskError(accountId: string, message: string): Promise<'disabled' | 'safety' | 'recorded'> {
    const msg = String(message || '');
    if (isRunwayTokenRevokedError(msg)) {
      await this.disableAccount(accountId, `token invalid/revoked: ${msg.slice(0, 260)}`);
      return 'disabled';
    }
    if (isRunwaySafetyError(msg)) {
      if (!(await this.isContentReviewEnabled())) {
        await this.recordError(accountId, msg);
        console.warn(`[account-pool] content review disabled, safety failure recorded without disabling ${accountId.slice(0,8)}`);
        return 'recorded';
      }
      const count = await this.recordSafetyFailure(accountId, msg);
      return count >= SAFETY_FAILURE_DAILY_LIMIT ? 'disabled' : 'safety';
    }
    await this.recordError(accountId, msg);
    return 'recorded';
  }

  /** Increment totalGenerated counter */
  async incrementGenerated(accountId: string): Promise<void> {
    await this.prisma.runwayAccount.update({
      where: { id: accountId },
      data: { totalGenerated: { increment: 1 } },
    }).catch(() => {});
  }

  /** Get current concurrency for an account from Redis */
  async getConcurrency(accountId: string): Promise<number> {
    const val = await this.redis.get(`account:concurrency:${accountId}`);
    return val ? parseInt(val, 10) : 0;
  }

  /** Get stats for all accounts (for admin API) */
  async getStats(): Promise<Array<AccountEntry & { currentConcurrency: number }>> {
    const accounts = await this.getAccounts();
    const stats = await Promise.all(
      accounts.map(async a => ({
        ...a,
        currentConcurrency: await this.getConcurrency(a.id),
      }))
    );
    return stats;
  }

  /**
   * Reconcile Redis counters with our DB's active job count (not Runway API).
   * Only count jobs WE submitted — external tasks on the same account are ignored.
   */
  async reconcile(): Promise<void> {
    const accounts = await this.getAccounts();
    for (const account of accounts) {
      try {
        // Count jobs that are occupying Runway platform slots.
        // THROTTLED/PENDING remote tasks still count on Runway, so keep Redis aligned with DB.
        const dbActive = await this.prisma.runwayJob.count({
          where: {
            accountId: account.id,
            status: { in: ['submitted', 'processing'] },
          },
        });
        const redisKey = `account:concurrency:${account.id}`;
        const redisVal = parseInt(await this.redis.get(redisKey) || '0', 10);

        if (redisVal !== dbActive) {
          console.log(`[account-pool:reconcile] ${account.label}: redis=${redisVal} db=${dbActive}, correcting`);
          if (dbActive > 0) {
            await this.redis.set(redisKey, String(dbActive), 'EX', CONCURRENCY_TTL);
          } else {
            await this.redis.del(redisKey);
          }
        } else if (dbActive > 0) {
          await this.redis.expire(redisKey, CONCURRENCY_TTL);
        }
      } catch (e: any) {
        console.warn(`[account-pool:reconcile] ${account.label} error: ${e.message}`);
      }
    }
  }
}
