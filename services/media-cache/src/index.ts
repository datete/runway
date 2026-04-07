import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import fetch from "node-fetch";

const PORT = parseInt(process.env.MEDIA_CACHE_PORT || "3101", 10);
const VIDEOS_DIR = process.env.MEDIA_CACHE_DIR || path.resolve(__dirname, "../../../uploads/videos");
const AUTH_KEYS = (process.env.AUTH_SECRET_KEY || "").split(",").map(s => s.trim()).filter(Boolean);

if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: "1mb" }));

const auth = (req: Request, res: Response, next: NextFunction) => {
  if (AUTH_KEYS.length === 0) return next();
  const tok = (req.header("X-Ptoken") || "").trim();
  if (!tok || !AUTH_KEYS.includes(tok)) {
    return res.status(401).json({ code: "token_check", message: "no access" });
  }
  next();
};

// In-flight downloads, keyed by filename, to dedupe concurrent requests
const inflight = new Map<string, Promise<void>>();

function fileNameFor(url: string, key?: string) {
  const h = crypto.createHash("sha1").update(`${key || ""}|${url}`).digest("hex");
  return `${h}.mp4`;
}

async function downloadTo(url: string, dest: string) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const tmp = `${dest}.part`;
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    res.body.pipe(out);
    res.body.on("error", reject);
    out.on("finish", () => resolve());
    out.on("error", reject);
  });
  fs.renameSync(tmp, dest);
}

app.post("/api/cache-video", auth, async (req, res) => {
  const { url, key } = req.body || {};
  if (!url || typeof url !== "string" || !/^https?:\/\//.test(url)) {
    return res.status(400).json({ error: "invalid url" });
  }
  const fname = fileNameFor(url, key);
  const dest = path.join(VIDEOS_DIR, fname);
  const localUrl = `/videos/${fname}`;

  if (fs.existsSync(dest)) {
    return res.json({ localUrl, cached: true });
  }
  try {
    let p = inflight.get(fname);
    if (!p) {
      p = downloadTo(url, dest).finally(() => inflight.delete(fname));
      inflight.set(fname, p);
    }
    await p;
    res.json({ localUrl, cached: false });
  } catch (e: any) {
    console.error("[cache-video] failed:", e.message);
    res.status(502).json({ error: e.message || "download failed" });
  }
});

app.get("/videos/:file", (req, res) => {
  const f = req.params.file;
  if (!/^[a-f0-9]{40}\.mp4$/.test(f)) return res.status(400).end();
  const p = path.join(VIDEOS_DIR, f);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Cache-Control", "public, max-age=2592000");
  fs.createReadStream(p).pipe(res);
});

app.get("/health", (_, res) => res.json({ ok: true, dir: VIDEOS_DIR }));


// 7-day auto cleanup of cached videos (only files we manage: sha1.mp4)
const ONE_DAY = 86400_000
const MAX_AGE_MS = 7 * ONE_DAY
function runCleanup() {
  try {
    const now = Date.now()
    let removed = 0
    for (const f of fs.readdirSync(VIDEOS_DIR)) {
      if (!/^[a-f0-9]{40}\.mp4$/.test(f)) continue
      const fp = path.join(VIDEOS_DIR, f)
      try {
        const st = fs.statSync(fp)
        if (now - st.mtimeMs > MAX_AGE_MS) { fs.unlinkSync(fp); removed++ }
      } catch {}
    }
    if (removed > 0) console.log(`[media-cache] cleanup removed ${removed} files`)
  } catch (e: any) { console.warn("[media-cache] cleanup error:", e.message) }
}
setInterval(runCleanup, 6 * 60 * 60 * 1000)
setTimeout(runCleanup, 5000)

app.listen(PORT, () => console.log(`[media-cache] listening on :${PORT} dir=${VIDEOS_DIR}`));
