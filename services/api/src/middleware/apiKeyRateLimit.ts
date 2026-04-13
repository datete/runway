import { Request, Response, NextFunction } from "express";
import { redisConnection } from "../queues/runway.queue";

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
    const count = await redisConnection.incr(redisKey);

    if (count === 1) {
      await redisConnection.expire(redisKey, 60);
    }

    const ttl = await redisConnection.ttl(redisKey);
    const resetSeconds = ttl > 0 ? ttl : 60;

    if (count > limit) {
      res.set("X-RateLimit-Limit", String(limit));
      res.set("X-RateLimit-Remaining", "0");
      res.set("X-RateLimit-Reset", String(resetSeconds));
      res.status(429).json({
        error: "Rate limit exceeded",
        limit,
        retry_after: resetSeconds,
      });
      return;
    }

    res.set("X-RateLimit-Limit", String(limit));
    res.set("X-RateLimit-Remaining", String(Math.max(0, limit - count)));
    res.set("X-RateLimit-Reset", String(resetSeconds));

    next();
  } catch (err) {
    console.error("apiKeyRateLimitMiddleware error:", err);
    // Fail open: allow the request through if Redis is unavailable
    next();
  }
}
