import IORedis from 'ioredis';

export interface TokenEntry {
  token: string;
  teamId: number;
  id: string; // last 16 chars of token, used as Redis key suffix
}

const COOLDOWN_SECONDS = 60;

export function parseTokens(): TokenEntry[] {
  const multi = process.env.RUNWAY_TOKENS;
  if (multi) {
    return multi.split(',').map(pair => {
      const [token, teamIdStr] = pair.trim().split(':');
      return { token, teamId: Number(teamIdStr), id: token.slice(-16) };
    }).filter(t => t.token && t.teamId);
  }
  const t = process.env.RUNWAY_TOKEN;
  const id = Number(process.env.RUNWAY_TEAM_ID);
  if (t && id) return [{ token: t, teamId: id, id: t.slice(-16) }];
  return [];
}

export class TokenPool {
  private tokens: TokenEntry[];
  private redis: IORedis;
  private rrIndex = 0;

  constructor(redis: IORedis) {
    this.redis = redis;
    this.tokens = parseTokens();
    if (this.tokens.length === 0) throw new Error('No RUNWAY tokens configured (set RUNWAY_TOKENS or RUNWAY_TOKEN+RUNWAY_TEAM_ID)');
    console.log(`[token-pool] loaded ${this.tokens.length} token(s)`);
  }

  /** Round-robin, skipping tokens in cooldown. Returns null if all cooled. */
  async acquire(): Promise<TokenEntry | null> {
    const n = this.tokens.length;
    for (let i = 0; i < n; i++) {
      const idx = (this.rrIndex + i) % n;
      const t = this.tokens[idx];
      const cooled = await this.redis.get(`runway:token:cd:${t.id}`);
      if (!cooled) {
        this.rrIndex = (idx + 1) % n;
        return t;
      }
    }
    return null;
  }

  /** Mark token as cooled for COOLDOWN_SECONDS after a 429. */
  async setCooldown(tokenId: string): Promise<void> {
    await this.redis.set(`runway:token:cd:${tokenId}`, '1', 'EX', COOLDOWN_SECONDS);
    console.log(`[token-pool] token ....${tokenId} cooled for ${COOLDOWN_SECONDS}s`);
  }

  getAll(): TokenEntry[] { return this.tokens; }
}
