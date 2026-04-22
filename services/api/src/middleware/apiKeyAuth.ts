import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { prisma } from "../services/prisma";

interface ApiKeyRow {
  id: string;
  user_id: string;
  rate_limit: number;
  enabled: boolean;
  expires_at: Date | null;
  username: string;
  role: string;
  is_active: boolean;
}

export async function apiKeyAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;

    if (!token.startsWith("sk-")) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    const keyHash = crypto.createHash("sha256").update(token).digest("hex");

    const rows = await prisma.$queryRaw<ApiKeyRow[]>`
      SELECT k.id, k.user_id, k.rate_limit, k.enabled, k.expires_at,
             u.username, u.role, u.is_active
      FROM api_keys k
      JOIN users u ON u.id = k.user_id
      WHERE k.key_hash = ${keyHash} AND k.enabled = true
    `;

    if (!rows || rows.length === 0) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    const row = rows[0];

    if (row.expires_at && new Date(row.expires_at) <= new Date()) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    if (!row.is_active) {
      res.status(403).json({ error: "账号已被禁用" });
      return;
    }

    req.user = { id: row.user_id, username: row.username, role: row.role };
    (req as any).apiKeyId = row.id;
    (req as any).rateLimit = row.rate_limit;

    // Fire-and-forget: update last_used_at
    prisma.$executeRaw`UPDATE api_keys SET last_used_at = NOW() WHERE id = ${row.id}`.catch(
      () => {}
    );

    next();
  } catch (err) {
    console.error("apiKeyAuthMiddleware error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
