import { Request, Response, NextFunction } from "express";
import { prisma } from "../services/prisma";

/**
 * API call logger middleware for /v1/* routes.
 * Records: method, path, model, status, duration, ip, user_agent, generation_id.
 * Writes to api_call_logs table (fire-and-forget, doesn't block response).
 */
export function apiCallLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();

  // Capture response body to extract generation_id and error
  let responseBody: any = null;
  const origJson = res.json.bind(res);
  res.json = (body: any) => {
    responseBody = body;
    return origJson(body);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    const apiKeyId = (req as any).apiKeyId ?? null;
    const userId = (req as any).user?.id ?? null;
    const model = (req.body?.model as string | undefined) ?? null;
    const generationId = responseBody?.id ?? null;
    const errorMessage = responseBody?.error?.message ?? null;
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      null;
    const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;

    // Fire-and-forget insert
    prisma
      .$executeRaw`
      INSERT INTO api_call_logs (
        api_key_id, user_id, method, path, model,
        status_code, duration_ms, ip_address, user_agent,
        generation_id, error_message
      ) VALUES (
        ${apiKeyId}, ${userId}::uuid, ${req.method}, ${req.originalUrl || req.url}, ${model},
        ${res.statusCode}, ${duration}, ${ip}, ${userAgent},
        ${generationId}, ${errorMessage}
      )
    `.catch((e) => {
      console.error("[apiCallLogger] insert failed:", e?.message ?? e);
    });
  });

  next();
}
