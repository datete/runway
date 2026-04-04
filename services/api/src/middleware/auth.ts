import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../services/prisma";

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

const JWT_SECRET = process.env.RUNWAY_JWT_SECRET || "runway-secret-change-me";

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
    // Validate id is a UUID before querying DB
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof payload.id === 'string' && uuidRe.test(payload.id)) {
      // Check isActive from DB for immediate effect when user is disabled
      prisma.user.findUnique({ where: { id: payload.id }, select: { isActive: true } })
        .then(u => {
          if (!u || !u.isActive) return res.status(403).json({ error: "账号已被禁用" });
          req.user = payload;
          next();
        })
        .catch((err) => {
          console.error('[auth] DB check failed:', err.message);
          // DB error — still let request through with verified JWT
          req.user = payload;
          next();
        });
    } else {
      // Legacy token with non-UUID id — trust JWT signature, skip DB check
      req.user = payload;
      next();
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
