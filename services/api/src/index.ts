import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fetch from 'node-fetch';
import { runwayRouter } from './routes/runway';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';

const app = express();
const PORT = Number(process.env.API_PORT) || 5102;
const WEB_BASE = 'http://127.0.0.1:3002';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

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

    const data = await upstream.text();
    const ct = upstream.headers.get('content-type') || 'application/json';
    res.status(upstream.status).set('content-type', ct).send(data);
  } catch (err: any) {
    console.error('[proxy] error:', err.message);
    res.status(502).json({ error: 'web service unavailable' });
  }
}

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

app.listen(PORT, () => {
  console.log(`[runway-api] listening on :${PORT}`);
});
