import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../services/prisma";
import { redisConnection as authRedis } from "../queues/runway.queue";

export interface AuthUser {
  id: string;
  username: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// #9: Require JWT secret from env — no weak defaults
if (!process.env.RUNWAY_JWT_SECRET) {
  console.error("[FATAL] RUNWAY_JWT_SECRET is not set. Exiting.");
  process.exit(1);
}
const JWT_SECRET = process.env.RUNWAY_JWT_SECRET;

// Redis: reuse shared connection from runway.queue

const AUTH_CACHE_TTL = 30; // seconds

type ActiveCheck =
  | { kind: "active" }
  | { kind: "inactive" }
  | { kind: "missing" }
  | { kind: "error"; err: unknown };

async function checkUserActive(userId: string): Promise<ActiveCheck> {
  const cacheKey = `auth:active:${userId}`;
  try {
    const cached = await authRedis.get(cacheKey);
    if (cached === "1") return { kind: "active" };
    if (cached === "0") return { kind: "inactive" };
  } catch (err) {
    console.warn("[auth] redis get failed:", (err as any)?.message ?? err);
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
    if (!user) return { kind: "missing" };
    authRedis.setex(cacheKey, AUTH_CACHE_TTL, user.isActive ? "1" : "0").catch(() => {});
    return user.isActive ? { kind: "active" } : { kind: "inactive" };
  } catch (err) {
    return { kind: "error", err };
  }
}

/** Call when disabling/enabling a user to bust cache immediately */
export async function invalidateUserCache(userId: string) {
  await authRedis.del(`auth:active:${userId}`).catch(() => {});
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"] as string;
  const ptoken = req.headers["x-ptoken"] as string;

  let token: string | undefined;
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else if (ptoken) {
    token = ptoken;
  }

  if (!token) {
    return res.status(401).json({ error: "未登录" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof payload.id === "string" && uuidRe.test(payload.id)) {
      checkUserActive(payload.id)
        .then((result) => {
          switch (result.kind) {
            case "active":
              req.user = payload;
              return next();
            case "missing":
              return res.status(403).json({ error: "账号不存在" });
            case "inactive":
              return res.status(403).json({ error: "账号已被禁用" });
            case "error":
              console.error("[auth] DB check failed, rejecting:", (result.err as any)?.message ?? result.err);
              return res.status(503).json({ error: "鉴权服务暂时不可用，请稍后再试" });
          }
        })
        .catch((err) => {
          console.error("[auth] unexpected error, rejecting:", err?.message ?? err);
          return res.status(503).json({ error: "鉴权服务暂时不可用，请稍后再试" });
        });
    } else {
      return res.status(401).json({ error: "token 无效" });
    }
  } catch {
    return res.status(401).json({ error: "token 无效或已过期" });
  }
}

export function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  authMiddleware(req, res, () => {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ error: "需要管理员权限" });
    }
    next();
  });
}

export { JWT_SECRET };
