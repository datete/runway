// Structured business exceptions. Lets route handlers pick HTTP status by error type
// instead of pattern-matching Chinese substrings in the message.

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = this.constructor.name;
  }
}

export class ValidationError extends HttpError {
  constructor(message: string, code = "validation_error") {
    super(400, code, message);
  }
}

export class QuotaError extends HttpError {
  constructor(message: string, code = "quota_exceeded") {
    super(400, code, message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message: string, code = "forbidden") {
    super(403, code, message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string, code = "not_found") {
    super(404, code, message);
  }
}

/** Express response helper: send a known HttpError, or redact internal errors. */
export function sendError(res: import("express").Response, err: unknown, logTag = "handler") {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  const msg = (err as any)?.message ?? String(err);
  console.error(`[${logTag}] internal error:`, msg, (err as any)?.stack);
  return res.status(500).json({ error: "Internal server error", code: "internal_error" });
}
