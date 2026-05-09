import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fetch from 'node-fetch';
import { runwayRouter } from './routes/runway';
import { klingRouter } from './routes/kling';
import { prisma } from './services/prisma';
import { redisConnection } from './queues/runway.queue';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { borrowRouter } from './routes/borrow';
import { reviewRouter } from './routes/review';
import { v1Router } from './routes/v1';

const app = express();
const PORT = Number(process.env.API_PORT) || 5102;
const WEB_BASE = process.env.WEB_BASE || 'http://127.0.0.1:3002';
const MEDIA_CACHE_BASE = process.env.MEDIA_CACHE_BASE || 'http://127.0.0.1:3101';

app.use(cors());

// Let proxies that need raw bodies (multipart, arbitrary content-types) bypass the JSON parser.
// We only parse JSON for runway-local routes; upstream proxies stream the raw request.
const proxyPrefixes = [
  '/api/cache-video', '/videos',
  '/luma', '/mjapi', '/openapi', '/suno', '/sunoapi', '/viggle', '/pro', '/uploads', '/openai',
];
const proxyApiFallthrough = (url: string) =>
  url.startsWith('/api/') &&
  !url.startsWith('/api/runway') &&
  !url.startsWith('/api/kling') &&
  !url.startsWith('/api/review');

const jsonParser = express.json({ limit: '50mb' });
app.use((req, res, next) => {
  if (proxyPrefixes.some(p => req.url.startsWith(p)) || proxyApiFallthrough(req.url)) {
    return next();
  }
  return jsonParser(req, res, next);
});

// Response time logger — log slow requests (>1s) and all non-2xx
app.use((req, res, next) => {
  const start = Date.now();
  let capturedBody: any = null;
  const origJson = res.json.bind(res);
  (res as any).json = (body: any) => { capturedBody = body; return origJson(body); };
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (res.statusCode >= 400) {
      const bodyStr = capturedBody ? JSON.stringify(capturedBody).slice(0, 300) : '';
      console.log(`[err] ${req.method} ${req.url} ${res.statusCode} ${duration}ms ${bodyStr}`);
    } else if (duration > 1000) {
      console.log(`[slow] ${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// Request logger
app.use((req, _res, next) => {
  if (!req.url.startsWith('/assets') && !req.url.startsWith('/favicon'))
    console.log(`[req] ${req.method} ${req.url}`);
  next();
});

// Liveness: cheap check (service alive, event loop responsive)
app.get('/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

// Readiness: verify DB + Redis
app.get('/ready', async (_req, res) => {
  const start = Date.now();
  const report: any = { ok: true, ts: Date.now(), checks: {} };
  try {
    await prisma.$queryRaw`SELECT 1`;
    report.checks.db = { ok: true };
  } catch (e: any) {
    report.ok = false;
    report.checks.db = { ok: false, error: e?.message ?? String(e) };
  }
  try {
    const pong = await redisConnection.ping();
    report.checks.redis = { ok: pong === 'PONG' };
    if (pong !== 'PONG') report.ok = false;
  } catch (e: any) {
    report.ok = false;
    report.checks.redis = { ok: false, error: e?.message ?? String(e) };
  }
  report.durationMs = Date.now() - start;
  res.status(report.ok ? 200 : 503).json(report);
});

app.use('/img', express.static('/root/runway/uploads'));

// Runway API routes
app.use('/api/runway/auth', authRouter);
app.use('/api/runway/admin', adminRouter);
app.use('/api/runway/borrow', borrowRouter);
app.use('/api/runway', runwayRouter);
app.use('/api/kling', klingRouter);
app.use('/api/review', reviewRouter);

// V1 OpenAI-compatible API (API key auth)
app.use('/v1', v1Router);

// ── Proxy helpers ──────────────────────────────────────────────────────────
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

function buildProxyHeaders(req: express.Request, extraPassThrough: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    const lower = k.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    out[lower] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  const xff = (req.headers['x-forwarded-for'] as string | undefined);
  const clientIp = req.socket.remoteAddress || '';
  out['x-forwarded-for'] = xff ? `${xff}, ${clientIp}` : clientIp;
  out['x-forwarded-proto'] = (req.headers['x-forwarded-proto'] as string) || (req.secure ? 'https' : 'http');
  out['x-forwarded-host'] = (req.headers['x-forwarded-host'] as string) || (req.headers['host'] as string) || '';
  for (const h of extraPassThrough) {
    const v = req.headers[h.toLowerCase()];
    if (typeof v === 'string') out[h.toLowerCase()] = v;
  }
  return out;
}

async function proxyStream(baseUrl: string, targetPath: string, req: express.Request, res: express.Response, logTag: string) {
  try {
    const headers = buildProxyHeaders(req);
    const method = req.method.toUpperCase();
    const hasBody = !['GET', 'HEAD'].includes(method);
    const upstream = await fetch(`${baseUrl}${targetPath}`, {
      method,
      headers,
      body: hasBody ? (req as any) : undefined,
    });
    const ct = upstream.headers.get('content-type') || 'application/json';
    res.status(upstream.status).set('content-type', ct);
    const len = upstream.headers.get('content-length');
    if (len) res.set('content-length', len);
    if (upstream.body) (upstream.body as any).pipe(res);
    else res.end();
  } catch (err: any) {
    console.error(`[${logTag}] error:`, err.message);
    res.status(502).json({ error: `${logTag} upstream unavailable` });
  }
}

const proxyTo3002 = (targetPath: string, req: express.Request, res: express.Response) =>
  proxyStream(WEB_BASE, targetPath, req, res, 'proxy');

const proxyToMediaCache = (targetPath: string, req: express.Request, res: express.Response) =>
  proxyStream(MEDIA_CACHE_BASE, targetPath, req, res, 'media-cache proxy');

app.use('/api/cache-video', (req, res) => proxyToMediaCache(`/api/cache-video${req.url}`, req, res));
app.use('/videos', (req, res) => proxyToMediaCache(`/videos${req.url}`, req, res));

// Proxy /api/* (except /api/runway, /api/kling, /api/review) to web service on port 3002
app.use('/api', (req, res) => proxyTo3002(`/api${req.url}`, req, res));

// Proxy other chatgpt-web paths to 3002
const WEB_PATHS = ['/luma', '/mjapi', '/openapi', '/suno', '/sunoapi', '/viggle', '/pro', '/uploads', '/openai'];
WEB_PATHS.forEach(p => {
  app.use(p, (req, res) => proxyTo3002(`${p}${req.url}`, req, res));
});

// Serve Vue frontend static files
const distDir = path.join(__dirname, '../../../apps/web/dist');
app.use(express.static(distDir));
app.get('*', (_, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});


// ── 7-day auto cleanup ──
let cleanupRunning = false;
async function runCleanup() {
  if (cleanupRunning) {
    console.log('[cleanup] previous run still in progress, skipping');
    return;
  }
  cleanupRunning = true;
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deleted = await prisma.runwayJob.deleteMany({
      where: {
        createdAt: { lt: sevenDaysAgo },
        status: { in: ['completed', 'failed', 'cancelled', 'deleted'] },
      },
    });
    if (deleted.count > 0) console.log(`[cleanup] deleted ${deleted.count} old jobs (>7 days)`);
  } catch (e: any) {
    console.warn('[cleanup] error:', e.message);
  } finally {
    cleanupRunning = false;
  }
}
if (process.env.RUNWAY_DISABLE_STARTUP_CLEANUP === 'true') {
  console.log('[cleanup] disabled by RUNWAY_DISABLE_STARTUP_CLEANUP');
} else {
  setInterval(runCleanup, 6 * 60 * 60 * 1000); // every 6 hours
  setTimeout(runCleanup, 5000); // run once after startup
}

app.listen(PORT, () => {
  console.log(`[runway-api] listening on :${PORT}`);
});
