import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fetch from 'node-fetch';
import { runwayRouter } from './routes/runway';
import { klingRouter } from './routes/kling';
import { prisma } from './services/prisma';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { reviewRouter } from './routes/review';

const app = express();
const PORT = Number(process.env.API_PORT) || 5102;
const WEB_BASE = 'http://127.0.0.1:3002';

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// #12: Response time logger — log slow requests (>1s)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 1000) {
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

app.get('/health', (_, res) => res.json({ ok: true, ts: Date.now() }));
app.use('/img', express.static('/root/runway/uploads'));

// Runway API routes
app.use('/api/runway/auth', authRouter);
app.use('/api/runway/admin', adminRouter);
app.use('/api/runway', runwayRouter);
app.use('/api/kling', klingRouter);
app.use('/api/review', reviewRouter);

async function proxyTo3002(targetPath: string, req: express.Request, res: express.Response) {
  try {
    const body = req.body && Object.keys(req.body).length > 0
      ? JSON.stringify(req.body)
      : undefined;

    const headers: Record<string, string> = {
      'content-type': (req.headers['content-type'] as string) || 'application/json',
    };
    if (req.headers['authorization'])
      headers['authorization'] = req.headers['authorization'] as string;

    const upstream = await fetch(`${WEB_BASE}${targetPath}`, {
      method: req.method,
      headers,
      body,
    });

    // #4: Stream response instead of buffering entire body
    const ct = upstream.headers.get('content-type') || 'application/json';
    res.status(upstream.status).set('content-type', ct);
    if (upstream.body) {
      (upstream.body as any).pipe(res);
    } else {
      res.end();
    }
  } catch (err: any) {
    console.error('[proxy] error:', err.message);
    res.status(502).json({ error: 'web service unavailable' });
  }
}


// Proxy media-cache (download caching for legacy luma/pika videos)
const MEDIA_CACHE_BASE = process.env.MEDIA_CACHE_BASE || "http://127.0.0.1:3101";
async function proxyToMediaCache(targetPath: string, req: express.Request, res: express.Response) {
  try {
    const body = req.body && Object.keys(req.body).length > 0 ? JSON.stringify(req.body) : undefined;
    const headers: Record<string, string> = {
      "content-type": (req.headers["content-type"] as string) || "application/json",
    };
    if (req.headers["x-ptoken"]) headers["x-ptoken"] = req.headers["x-ptoken"] as string;
    const upstream = await fetch(`${MEDIA_CACHE_BASE}${targetPath}`, { method: req.method, headers, body });
    const ct = upstream.headers.get("content-type") || "application/json";
    res.status(upstream.status).set("content-type", ct);
    if (upstream.body) (upstream.body as any).pipe(res); else res.end();
  } catch (err: any) {
    console.error("[media-cache proxy] error:", err.message);
    res.status(502).json({ error: "media cache unavailable" });
  }
}
app.use("/api/cache-video", (req, res) => proxyToMediaCache(`/api/cache-video${req.url}`, req, res));
app.use("/videos", (req, res) => proxyToMediaCache(`/videos${req.url}`, req, res));

// Proxy /api/* (except /api/runway) to web service on port 3002
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
async function runCleanup() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deleted = await prisma.runwayJob.deleteMany({
      where: {
        createdAt: { lt: sevenDaysAgo },
        status: { in: ['completed', 'failed', 'cancelled', 'deleted'] },
      },
    });
    if (deleted.count > 0) console.log(`[cleanup] deleted ${deleted.count} old jobs (>7 days)`);
  } catch (e: any) { console.warn('[cleanup] error:', e.message); }
}
setInterval(runCleanup, 6 * 60 * 60 * 1000); // every 6 hours
setTimeout(runCleanup, 5000); // run once after startup

app.listen(PORT, async () => {
  console.log(`[runway-api] listening on :${PORT}`);
  // Upgrade queued std jobs to pro resolution
  try {
    await prisma.$executeRawUnsafe(`
      UPDATE runway_jobs SET
        resolution = CASE
          WHEN resolution = '720x1280' OR resolution IS NULL THEN '1076x1920'
          WHEN resolution = '1280x720' THEN '1920x1080'
          WHEN resolution = '960x960'  THEN '1440x1440'
          ELSE resolution
        END
      WHERE quality = 'std'
        AND status IN ('pending', 'queued')
    `);
    console.log('[startup] upgraded queued std jobs to pro resolution');
  } catch (e) { console.warn('[startup] migration skipped:', e.message); }
});
