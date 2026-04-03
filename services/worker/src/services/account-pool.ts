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
}

const COOLDOWN_SECONDS = 60;
const CACHE_TTL = 30; // seconds to cache account list
const CONCURRENCY_TTL = 900; // seconds for concurrency key safety TTL (15 min)

export class AccountPool {
  private redis: IORedis;
  private prisma: PrismaClient;
  private cachedAccounts: AccountEntry[] = [];
  private cacheExpiry = 0;

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
      orderBy: [{ priority: 'desc' }, { lastUsedAt: 'asc' }],
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
   * Returns the account entry or null if all accounts are full/cooled/expired.
   */
  async acquire(): Promise<AccountEntry | null> {
    const accounts = await this.getAccounts();
    const now = Date.now();

    for (const account of accounts) {
      // Check token expiry
      if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < now) {
        console.warn(`[account-pool] ${account.label} token expired, skipping`);
        continue;
      }

      // Check cooldown
      const cooled = await this.redis.get(`account:cooldown:${account.id}`);
      if (cooled) continue;

      // Atomic concurrency check: INCR and check
      const key = `account:concurrency:${account.id}`;
      const current = await this.redis.incr(key);

      if (current <= account.maxConcurrency) {
        // Set TTL on concurrency key as safety net
        await this.redis.expire(key, CONCURRENCY_TTL);
        console.log(`[account-pool] acquired ${account.label} (${current}/${account.maxConcurrency})`);

        // Update lastUsedAt in DB (non-blocking)
        this.prisma.runwayAccount.update({
          where: { id: account.id },
          data: { lastUsedAt: new Date() },
        }).catch(() => {});

        return account;
      } else {
        // Over limit, decrement back
        await this.redis.decr(key);
      }
    }

    return null;
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

  /** Set cooldown after a 429 rate limit */
  async setCooldown(accountId: string): Promise<void> {
    await this.redis.set(`account:cooldown:${accountId}`, '1', 'EX', COOLDOWN_SECONDS);
    console.log(`[account-pool] account ${accountId.slice(0, 8)} cooled for ${COOLDOWN_SECONDS}s`);
  }

  /** Record an error on an account */
  async recordError(accountId: string, message: string): Promise<void> {
    await this.prisma.runwayAccount.update({
      where: { id: accountId },
      data: { lastErrorAt: new Date(), lastErrorMessage: message },
    }).catch(() => {});
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

  /** Reconcile Redis counters with actual Runway API concurrency */
  async reconcile(getActiveFn: (token: string, teamId: string, proxyUrl?: string) => Promise<number>): Promise<void> {
    const accounts = await this.getAccounts();
    for (const account of accounts) {
      try {
        const actual = await getActiveFn(account.token, account.teamId, account.proxyUrl || undefined);
        const redisKey = `account:concurrency:${account.id}`;
        const redisVal = parseInt(await this.redis.get(redisKey) || '0', 10);

        if (redisVal !== actual) {
          console.log(`[account-pool:reconcile] ${account.label}: redis=${redisVal} actual=${actual}, correcting`);
          if (actual > 0) {
            await this.redis.set(redisKey, String(actual), 'EX', CONCURRENCY_TTL);
          } else {
            await this.redis.del(redisKey);
          }
        }
      } catch (e: any) {
        console.warn(`[account-pool:reconcile] ${account.label} error: ${e.message}`);
      }
    }
  }
}
