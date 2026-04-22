import { Request, Response, NextFunction } from "express";
import { redisConnection } from "../queues/runway.queue";

// Atomic INCR + set EXPIRE on first hit. Returns [count, ttlSeconds].
// Using Lua avoids the INCR/EXPIRE race where a crash between the two leaves a key without TTL.
const RATE_LIMIT_LUA = `
  local key = KEYS[1]
  local ttl = tonumber(ARGV[1])
  local c = redis.call('INCR', key)
  if c == 1 then
    redis.call('EXPIRE', key, ttl)
    return {c, ttl}
  end
  local t = redis.call('TTL', key)
  if t < 0 then
    redis.call('EXPIRE', key, ttl)
    t = ttl
  end
  return {c, t}
`;

const WINDOW_SECONDS = 60;

export async function apiKeyRateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKeyId = (req as any).apiKeyId as string | undefined;
  const rateLimit = (req as any).rateLimit as number | undefined;

  if (!apiKeyId) {
    next();
    return;
  }

  const limit = rateLimit ?? 60;
  const redisKey = `ratelimit:apikey:${apiKeyId}`;

  try {
    const result = (await redisConnection.eval(
      RATE_LIMIT_LUA,
      1,
      redisKey,
      String(WINDOW_SECONDS)
    )) as [number, number];
    const count = Number(result[0]);
    const ttl = Number(result[1]);
    const resetSeconds = ttl > 0 ? ttl : WINDOW_SECONDS;

    res.set("X-RateLimit-Limit", String(limit));
    res.set("X-RateLimit-Remaining", String(Math.max(0, limit - count)));
    res.set("X-RateLimit-Reset", String(resetSeconds));

    if (count > limit) {
      res.status(429).json({
        error: "Rate limit exceeded",
        limit,
        retry_after: resetSeconds,
      });
      return;
    }

    next();
  } catch (err) {
    console.error("apiKeyRateLimitMiddleware error:", err);
    // Fail open: allow the request through if Redis is unavailable
    next();
  }
}
