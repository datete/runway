import { Router } from "express";
import { RunwayController } from "../controllers/runway.controller";
import { authMiddleware, adminMiddleware } from "../middleware/auth";
import { prisma } from "../services/prisma";
import { redisConnection } from "../queues/runway.queue";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const ctrl = new RunwayController();
export const runwayRouter = Router();

const UPLOAD_ROOT = "/root/runway/uploads";
const DOWNLOAD_TOKEN_TTL_SECONDS = Number(process.env.RUNWAY_DOWNLOAD_TOKEN_TTL_SECONDS) || 60;
const MAX_BATCH_DOWNLOAD = Number(process.env.RUNWAY_BATCH_DOWNLOAD_MAX) || 20;
const DOWNLOAD_TOKEN_ENABLED = process.env.RUNWAY_DOWNLOAD_TOKEN_ENABLED !== "false";
const PROMPT_GUARD_ENABLED = process.env.RUNWAY_PROMPT_GUARD_ENABLED !== "false";
const CONTENT_REVIEW_KEY = "runway:content-review-enabled";
const TEMPLATE_LIMIT_PER_HOUR = Math.max(1, Number(process.env.RUNWAY_TEMPLATE_LIMIT_PER_HOUR) || 10);
const GLOBAL_TEMPLATE_LIMIT_PER_HOUR = Math.max(1, Number(process.env.RUNWAY_GLOBAL_TEMPLATE_LIMIT_PER_HOUR) || TEMPLATE_LIMIT_PER_HOUR);
const TEMPLATE_WINDOW_SECONDS = Math.max(300, Number(process.env.RUNWAY_TEMPLATE_WINDOW_SECONDS) || 3600);
const DIRECT_SUBMIT_LIMIT_PER_HOUR = Math.max(1, Number(process.env.RUNWAY_DIRECT_SUBMIT_LIMIT_PER_HOUR) || 30);
const STRICT_MINOR_GUARD = process.env.RUNWAY_ALLOW_MINOR_PROMPTS !== "true";
const SAFETY_FAILURE_DAILY_LIMIT = Math.max(1, Number(process.env.RUNWAY_SAFETY_FAILURE_DAILY_LIMIT) || 3);
const SAFETY_FAILURE_WINDOW_SECONDS = Math.max(300, Number(process.env.RUNWAY_SAFETY_FAILURE_WINDOW_SECONDS) || 24 * 60 * 60);

type NetworkSample = {
  name: string;
  rxBytes: number;
  txBytes: number;
};

type DownloadTokenPayload = {
  kind: "single" | "batch";
  userId: string;
  role: string;
  jobId?: string;
  ids?: string[];
  createdAt: number;
};

function readNetworkSamples(): NetworkSample[] {
  const text = fs.readFileSync("/proc/net/dev", "utf8");
  return text
    .split("\n")
    .slice(2)
    .map((line) => {
      const [rawName, rawStats] = line.split(":");
      const name = rawName?.trim();
      const fields = rawStats?.trim().split(/\s+/) || [];
      if (!name || fields.length < 16) return null;
      const rxBytes = Number(fields[0]);
      const txBytes = Number(fields[8]);
      if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) return null;
      return { name, rxBytes, txBytes };
    })
    .filter(Boolean) as NetworkSample[];
}

function isPrimaryNetworkInterface(name: string): boolean {
  if (name === "lo") return false;
  return !/^(docker|br-|veth|virbr|tun|tap|zt|tailscale|flannel|cni|kube|wg)/.test(name);
}

function networkTotals(samples: NetworkSample[]) {
  return samples.reduce(
    (total, item) => ({
      rxBytes: total.rxBytes + item.rxBytes,
      txBytes: total.txBytes + item.txBytes,
    }),
    { rxBytes: 0, txBytes: 0 },
  );
}

type PromptRisk = { blocked: boolean; reason?: string; keywords?: string[] };

function collectRiskKeywords(text: string, ...patterns: RegExp[]): string[] {
  const keywords: string[] = [];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const globalPattern = new RegExp(pattern.source, flags);
    let match: RegExpExecArray | null;
    while ((match = globalPattern.exec(text)) !== null) {
      if (match[0]) keywords.push(match[0]);
      if (keywords.length >= 12) break;
    }
  }
  return Array.from(new Set(
    keywords
      .map(k => k.trim())
      .filter(Boolean)
      .map(k => k.length > 32 ? `${k.slice(0, 32)}...` : k)
  )).slice(0, 6);
}

function blockedRisk(reason: string, text: string, ...patterns: RegExp[]): PromptRisk {
  return { blocked: true, reason, keywords: collectRiskKeywords(text, ...patterns) };
}

function inspectPromptRisk(prompt: unknown): PromptRisk {
  if (!PROMPT_GUARD_ENABLED) return { blocked: false };
  const text = String(prompt || "").toLowerCase();
  const evasion = /\b(bypass|jailbreak|uncensored|unfiltered|no censorship|ignore policy|ignore safety|no limits?|no restrictions?)\b|\u7ed5\u8fc7.*\u5ba1\u6838|\u7ed5\u8fc7.*\u5ba1\u67e5|\u65e0\u9650\u5236|\u4e0d\u8981\u9650\u5236/i;
  const prohibited = /\b(nsfw|nude|naked|nudity|porn|pornographic|erotic|rape|raped|sexual assault|suicide|self[- ]?harm|gore|gory|graphic blood)\b|\u8272\u60c5|\u88f8|\u88f8\u7167|\u5f3a\u5978|\u6027\u4fb5|\u81ea\u6740|\u81ea\u6b8b|\u8840\u8165/i;
  const sexual = /\b(sexy|sexual|sensual|seductive|provocative|lingerie|underwear|bikini|swimsuit|cleavage|breasts?|boobs?|nipples?|bra|panties|thong|see[- ]?through|revealing|curvy|hourglass|big breasts?|large breasts?|slim waist|wide hips?|butt|buttocks|\bass\b|fetish|intimate|adult|voyeur|non[- ]?consensual)\b|\u6027\u611f|\u8bf1\u60d1|\u5185\u8863|\u6bd4\u57fa\u5c3c|\u4e73\u6c9f|\u80f8|\u4e73\u623f|\u81c0|\u7fd8\u81c0|\u4e30\u6ee1\u80f8|\u4e30\u6ee1\u81c0|\u6210\u4eba|\u672a\u7ecf\u540c\u610f/i;
  const violence = /\b(violent|violence|blood|bloody|blood splatter|kill|killing|murder|gun|shoot|shooting|knife|stab|stabbing|fight|fighting|wound|wounded|injur(?:y|ed)|corpse|dead body|death|explosion|war|torture|pain|suffering|struggl(?:e|ing)|scream(?:ing)?|crying|crush|burn(?:ing)?|terroris[mt]|extremis[mt]|dismember|behead|beheading|mutilat(?:e|ed|ion)|organs?|bones?|abuse)\b|\u66b4\u529b|\u8840|\u6d41\u8840|\u6740|\u67aa|\u5200|\u6253\u6597|\u4f24\u53e3|\u5c38\u4f53|\u6b7b\u4ea1|\u7206\u70b8|\u6218\u4e89|\u75db\u82e6|\u6323\u624e|\u54ed\u95f9|\u6495\u788e|\u6050\u6016|\u8650\u5f85|\u80a2\u89e3|\u65a9\u9996|\u65ad\u5934|\u5668\u5b98|\u9aa8\u5934|\u6050\u6016\u4e3b\u4e49|\u6781\u7aef\u4e3b\u4e49/i;
  const minor = /\b(child|children|kid|kids|toddler|minor|minors|baby|babies|teen|teens|teenage|teenager|teenagers|underage|under 18|schoolgirl|schoolboy|young girl|young boy)\b|\u513f\u7ae5|\u5c0f\u5b69|\u5e7c\u513f|\u5b69\u5b50|\u672a\u6210\u5e74|\u5b9d\u5b9d|\u5a74\u513f/i;
  const hateHarassment = /\b(hate speech|racist|slur|nazi|kkk|harass(?:ment)?|bully|bullying|defame|defamation|intimidat(?:e|ion))\b|\u4ec7\u6068|\u6b67\u89c6|\u7eb3\u7cb9|\u9a9a\u6270|\u9738\u51cc|\u8fb1\u9a82|\u8bfd\u8c24/i;
  const deceptionRights = /\b(deepfake|face[- ]?swap|impersonat(?:e|ion)|celebrity|public figure|politician|president|living artist|style of .*artist)\b|\u6362\u8138|\u6df1\u5ea6\u4f2a\u9020|\u5192\u5145|\u8bef\u5bfc|\u540d\u4eba|\u660e\u661f|\u516c\u4f17\u4eba\u7269|\u653f\u6cbb\u4eba\u7269|\u603b\u7edf|\u5728\u4e16\u827a\u672f\u5bb6/i;
  const illegal = /\b(drug|drugs|cocaine|meth|weapon making|bomb making|scam|fraud|phishing)\b|\u6bd2\u54c1|\u5438\u6bd2|\u8d29\u6bd2|\u70b8\u5f39|\u8bc8\u9a97|\u9493\u9c7c|\u8fdd\u6cd5/i;
  if (evasion.test(text)) return blockedRisk("safety-evasion or uncensored wording", text, evasion);
  if (prohibited.test(text)) return blockedRisk("prohibited sexual/graphic/self-harm keyword", text, prohibited);
  if (minor.test(text) && (sexual.test(text) || violence.test(text))) return blockedRisk("minor combined with sexual or violent context", text, minor, sexual, violence);
  if (STRICT_MINOR_GUARD && minor.test(text)) return blockedRisk("child/minor keyword blocked by strict safety guard", text, minor);
  if (sexual.test(text)) return blockedRisk("sexualized body or adult keyword", text, sexual);
  if (violence.test(text)) return blockedRisk("violent distress or injury keyword", text, violence);
  if (hateHarassment.test(text)) return blockedRisk("hate harassment or self-harm adjacent keyword", text, hateHarassment);
  if (deceptionRights.test(text)) return blockedRisk("impersonation public-figure or rights-risk keyword", text, deceptionRights);
  if (illegal.test(text)) return blockedRisk("illegal activity keyword", text, illegal);
  return { blocked: false };
}

function normalizePromptTemplate(prompt: unknown): string {
  return String(prompt || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[0-9]+/g, "#")
    .replace(/[，。！？、,.!?;:()[\]{}"'<>`~\-_/\\|]+/g, "")
    .replace(/\s+/g, "")
    .slice(0, 320);
}

function promptTemplateHash(prompt: unknown): string {
  const normalized = normalizePromptTemplate(prompt);
  return crypto.createHash("sha1").update(normalized || String(prompt || "").slice(0, 120)).digest("hex").slice(0, 16);
}

function localRiskMessage(reason?: string): string {
  const r = reason || "";
  if (r.includes("child/minor")) return "包含儿童/未成年相关内容";
  if (r.includes("minor combined")) return "儿童/未成年内容与敏感场景组合";
  if (r.includes("sexual")) return "包含色情、裸露或性暗示内容";
  if (r.includes("violent")) return "包含暴力、血腥、痛苦或危险行为内容";
  if (r.includes("evasion")) return "包含绕过审核或无限制生成相关表述";
  if (r.includes("hate")) return "包含仇恨、骚扰或辱骂相关内容";
  if (r.includes("impersonation")) return "包含名人、公人物、换脸、冒充或版权风险内容";
  if (r.includes("illegal")) return "包含违法、毒品、诈骗或武器相关内容";
  return "提示词命中本地安全规则";
}

function keywordDetail(keywords?: string[]): string {
  return keywords && keywords.length > 0 ? `；命中关键词：${keywords.join("、")}` : "";
}

async function isContentReviewEnabled(): Promise<boolean> {
  if (!PROMPT_GUARD_ENABLED) return false;
  const raw = await redisConnection.get(CONTENT_REVIEW_KEY).catch(() => null);
  return raw === null ? true : raw === "1";
}

async function validateDirectRunwayPrompt(userId: string | undefined, prompt: unknown, source: string): Promise<string | null> {
  if (!(await isContentReviewEnabled())) return null;
  const risk = inspectPromptRisk(prompt);
  if (risk.blocked) {
    const blockKey = `risk:local-blocks:${source}:${userId || "anon"}`;
    await redisConnection.incr(blockKey).then((count) => {
      if (count === 1) return redisConnection.expire(blockKey, TEMPLATE_WINDOW_SECONDS);
      return undefined;
    }).catch(() => {});
    return `提示词触发本地风控，未提交 Runway：${localRiskMessage(risk.reason)}${keywordDetail(risk.keywords)}`;
  }
  const hash = promptTemplateHash(prompt);
  const userKey = `risk:template:user:${userId || "anon"}:${hash}`;
  const userCount = await redisConnection.incr(userKey);
  if (userCount === 1) await redisConnection.expire(userKey, TEMPLATE_WINDOW_SECONDS);
  if (userCount > TEMPLATE_LIMIT_PER_HOUR) {
    return `相同/相似提示词提交过于频繁，未提交 Runway（${userCount}/${TEMPLATE_LIMIT_PER_HOUR}，${TEMPLATE_WINDOW_SECONDS}秒窗口）`;
  }
  const globalKey = `risk:template:global:${hash}`;
  const globalCount = await redisConnection.incr(globalKey);
  if (globalCount === 1) await redisConnection.expire(globalKey, TEMPLATE_WINDOW_SECONDS);
  if (globalCount > GLOBAL_TEMPLATE_LIMIT_PER_HOUR) {
    return `全站相同/相似提示词提交过于频繁，未提交 Runway（${globalCount}/${GLOBAL_TEMPLATE_LIMIT_PER_HOUR}，${TEMPLATE_WINDOW_SECONDS}秒窗口）`;
  }
  const directSubmitKey = "risk:direct-submit:global";
  const directSubmitCount = await redisConnection.incr(directSubmitKey);
  if (directSubmitCount === 1) await redisConnection.expire(directSubmitKey, TEMPLATE_WINDOW_SECONDS);
  if (directSubmitCount > DIRECT_SUBMIT_LIMIT_PER_HOUR) {
    return `Runway 提交过于频繁，已本地拦截（${directSubmitCount}/${DIRECT_SUBMIT_LIMIT_PER_HOUR}，${TEMPLATE_WINDOW_SECONDS}秒窗口）`;
  }
  return null;
}

function safeDownloadName(id: string) {
  return `runway-${id.slice(0, 8)}.mp4`;
}

function localUploadPathFromUrl(url?: string | null) {
  if (!url || !url.startsWith("/img/")) return null;
  try {
    const relative = decodeURIComponent(url.slice("/img/".length)).replace(/^[/\\]+/, "");
    const resolvedRoot = path.resolve(UPLOAD_ROOT);
    const resolvedPath = path.resolve(resolvedRoot, relative);
    if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + path.sep)) return null;
    return resolvedPath;
  } catch {
    return null;
  }
}

async function streamRemoteDownload(remoteUrl: string, filename: string, res: any) {
  let parsed: URL;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    return res.status(400).json({ error: "invalid download url" });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return res.status(400).json({ error: "invalid download url" });
  }

  const fetchMod = await import("node-fetch");
  const fetchFn = fetchMod.default;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const upstream = await fetchFn(remoteUrl, { signal: controller.signal as any });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return res.status(upstream.status).json({ error: `remote download failed ${upstream.status}`, detail: text.slice(0, 200) });
    }
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "video/mp4");
    const len = upstream.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    upstream.body.pipe(res);
    upstream.body.on("end", () => clearTimeout(timer));
    upstream.body.on("error", () => clearTimeout(timer));
  } catch (e: any) {
    clearTimeout(timer);
    if (!res.headersSent) {
      const msg = e?.name === "AbortError" ? "remote download timeout" : (e?.message || "remote download failed");
      res.status(502).json({ error: msg });
    } else {
      res.end();
    }
  }
}

function downloadTokenKey(token: string) {
  return `runway:download-token:${token}`;
}

async function createDownloadToken(payload: DownloadTokenPayload) {
  const token = crypto.randomBytes(24).toString("base64url");
  await redisConnection.setex(downloadTokenKey(token), DOWNLOAD_TOKEN_TTL_SECONDS, JSON.stringify(payload));
  return token;
}

async function readDownloadToken(token: unknown, expectedKind: "single" | "batch") {
  if (!DOWNLOAD_TOKEN_ENABLED || typeof token !== "string" || !token) return null;
  const raw = await redisConnection.get(downloadTokenKey(token)).catch(() => null);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as DownloadTokenPayload;
    if (payload.kind !== expectedKind || !payload.userId || !payload.role) return null;
    return payload;
  } catch {
    return null;
  }
}

function canAccessJob(job: any, user?: { id?: string; role?: string } | null) {
  if (!job || job.status === "deleted") return false;
  if (user?.role === "admin") return true;
  return !!user?.id && job.userId === user.id;
}

async function findDownloadableJob(jobId: string, user?: { id?: string; role?: string } | null) {
  const job = await prisma.runwayJob.findUnique({ where: { id: jobId } }) as any;
  if (!job || job.status === "deleted") return { status: 404 as const, error: "任务不存在" };
  if (!canAccessJob(job, user)) return { status: 403 as const, error: "无权下载该任务" };
  return { status: 200 as const, job };
}

async function streamJobDownload(job: any, res: any) {
  const filename = safeDownloadName(job.id);
  const localPath = localUploadPathFromUrl(job.resultUrl);
  if (localPath && fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
    return res.download(localPath, filename);
  }

  const remoteUrl = job.videoUrl || (typeof job.resultUrl === "string" && job.resultUrl.startsWith("http") ? job.resultUrl : "");
  if (!remoteUrl) {
    return res.status(404).json({ error: "暂无可下载的视频文件" });
  }
  return streamRemoteDownload(remoteUrl, filename, res);
}

function sanitizeZipName(name: string) {
  const cleaned = name.replace(/[\\/:*?"<>|\r\n\t]/g, "_").trim();
  return cleaned || "video";
}

function zipFileName(job: any) {
  return sanitizeZipName(`${String(job.id).slice(0, 8)}_${String(job.prompt || "video").slice(0, 20)}.mp4`);
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Update(crc: number, buf: Buffer) {
  let c = crc;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

async function writeZipBuffer(res: any, state: { offset: number }, chunk: Buffer) {
  state.offset += chunk.length;
  if (res.write(chunk)) return;
  await new Promise<void>((resolve) => res.once("drain", resolve));
}

async function openJobSource(job: any) {
  const localPath = localUploadPathFromUrl(job.resultUrl);
  if (localPath && fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
    return { stream: fs.createReadStream(localPath), cleanup: () => {} };
  }

  const remoteUrl = job.videoUrl || (typeof job.resultUrl === "string" && job.resultUrl.startsWith("http") ? job.resultUrl : "");
  if (!remoteUrl) throw new Error("no download url");
  const fetchMod = await import("node-fetch");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  const upstream = await fetchMod.default(remoteUrl, { signal: controller.signal as any });
  if (!upstream.ok || !upstream.body) {
    clearTimeout(timer);
    throw new Error(`remote download failed ${upstream.status}`);
  }
  return {
    stream: upstream.body as any,
    cleanup: () => clearTimeout(timer),
  };
}

async function writeZipEntry(res: any, state: { offset: number }, filename: string, source: any, entries: any[]) {
  const nameBuf = Buffer.from(filename);
  const { dosTime, dosDate } = dosDateTime();
  const localOffset = state.offset;
  const localHeader = Buffer.alloc(30 + nameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0x08, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(dosTime, 10);
  localHeader.writeUInt16LE(dosDate, 12);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  nameBuf.copy(localHeader, 30);
  await writeZipBuffer(res, state, localHeader);

  let crc = 0xffffffff;
  let size = 0;
  try {
    for await (const chunk of source.stream as AsyncIterable<Buffer>) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      crc = crc32Update(crc, buf);
      size += buf.length;
      if (size > 0xffffffff) throw new Error("zip entry too large");
      await writeZipBuffer(res, state, buf);
    }
  } finally {
    source.cleanup?.();
  }

  const finalCrc = (crc ^ 0xffffffff) >>> 0;
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(finalCrc, 4);
  descriptor.writeUInt32LE(size, 8);
  descriptor.writeUInt32LE(size, 12);
  await writeZipBuffer(res, state, descriptor);
  entries.push({ filename, nameBuf, crc: finalCrc, size, localOffset, dosTime, dosDate });
}

async function streamBatchZip(jobs: any[], res: any) {
  const state = { offset: 0 };
  const entries: any[] = [];
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="video_batch_${Date.now()}.zip"`);
  res.setHeader("Cache-Control", "no-store");

  for (const job of jobs) {
    if (!(job.resultUrl || job.videoUrl)) continue;
    try {
      const source = await openJobSource(job);
      await writeZipEntry(res, state, zipFileName(job), source, entries);
    } catch (e: any) {
      console.warn(`[batch-download] skip ${job.id}:`, e?.message || e);
    }
  }

  const centralStart = state.offset;
  for (const entry of entries) {
    const central = Buffer.alloc(46 + entry.nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x08, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(entry.dosTime, 12);
    central.writeUInt16LE(entry.dosDate, 14);
    central.writeUInt32LE(entry.crc, 16);
    central.writeUInt32LE(entry.size, 20);
    central.writeUInt32LE(entry.size, 24);
    central.writeUInt16LE(entry.nameBuf.length, 28);
    central.writeUInt32LE(entry.localOffset, 42);
    entry.nameBuf.copy(central, 46);
    await writeZipBuffer(res, state, central);
  }
  const centralSize = state.offset - centralStart;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  await writeZipBuffer(res, state, eocd);
  res.end();
}

runwayRouter.get("/system/network", (_req, res) => {
  try {
    const samples = readNetworkSamples();
    const primary = samples.filter((item) => isPrimaryNetworkInterface(item.name));
    const interfaces = primary.length > 0 ? primary : samples.filter((item) => item.name !== "lo");
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      ts: Date.now(),
      total: networkTotals(interfaces),
      interfaces,
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Jobs routes — require auth
runwayRouter.post("/jobs", authMiddleware, (req, res) => ctrl.createJob(req, res));
runwayRouter.post("/jobs/batch", authMiddleware, (req, res) => ctrl.batchCreateJobs(req, res));
runwayRouter.get("/jobs", authMiddleware, (req, res) => ctrl.listJobs(req, res));
runwayRouter.post("/jobs/:id/download-token", authMiddleware, async (req, res) => {
  try {
    if (!DOWNLOAD_TOKEN_ENABLED) return res.status(404).json({ error: "download token disabled" });
    const found = await findDownloadableJob(req.params.id, req.user);
    if (found.status !== 200) return res.status(found.status).json({ error: found.error });
    if (!(found.job.resultUrl || found.job.videoUrl)) return res.status(404).json({ error: "暂无可下载的视频文件" });
    const token = await createDownloadToken({ kind: "single", userId: req.user!.id, role: req.user!.role, jobId: req.params.id, createdAt: Date.now() });
    res.json({ url: `/api/runway/jobs/${req.params.id}/download?downloadToken=${encodeURIComponent(token)}`, expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "download token failed" });
  }
});

runwayRouter.post("/jobs/batch-download-token", authMiddleware, async (req, res) => {
  try {
    if (!DOWNLOAD_TOKEN_ENABLED) return res.status(404).json({ error: "download token disabled" });
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids.filter((id: any) => typeof id === "string") : []) as string[];
    const uniqueIds = Array.from(new Set(ids)).slice(0, MAX_BATCH_DOWNLOAD);
    if (uniqueIds.length === 0) return res.status(400).json({ error: "ids required" });
    const jobs = await prisma.runwayJob.findMany({ where: { id: { in: uniqueIds } } }) as any[];
    const allowed = jobs.filter(job => canAccessJob(job, req.user) && job.status === "completed" && (job.resultUrl || job.videoUrl)).map(job => job.id);
    if (allowed.length === 0) return res.status(404).json({ error: "暂无可下载的视频文件" });
    const token = await createDownloadToken({ kind: "batch", userId: req.user!.id, role: req.user!.role, ids: allowed, createdAt: Date.now() });
    res.json({ url: `/api/runway/jobs/batch-download?downloadToken=${encodeURIComponent(token)}`, expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS, count: allowed.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "batch download token failed" });
  }
});

runwayRouter.get("/jobs/batch-download", async (req, res) => {
  try {
    const payload = await readDownloadToken(req.query.downloadToken, "batch");
    if (!payload?.ids?.length) return res.status(401).json({ error: "下载链接已过期" });
    const jobs = await prisma.runwayJob.findMany({ where: { id: { in: payload.ids } } }) as any[];
    const jobMap = new Map(jobs.map(job => [job.id, job]));
    const ordered = payload.ids.map(id => jobMap.get(id)).filter(Boolean).filter(job => canAccessJob(job, payload) && job.status === "completed");
    if (ordered.length === 0) return res.status(404).json({ error: "暂无可下载的视频文件" });
    return streamBatchZip(ordered, res);
  } catch (e: any) {
    if (!res.headersSent) res.status(500).json({ error: e.message || "batch download failed" });
    else res.end();
  }
});

const handleSingleDownload = async (req: any, res: any) => {
  try {
    const found = await findDownloadableJob(req.params.id, req.user);
    if (found.status !== 200) return res.status(found.status).json({ error: found.error });
    return streamJobDownload(found.job, res);
  } catch (e: any) {
    if (!res.headersSent) res.status(500).json({ error: e.message || "download failed" });
    else res.end();
  }
};

runwayRouter.get("/jobs/:id/download", async (req, res) => {
  const payload = await readDownloadToken(req.query.downloadToken, "single");
  if (payload?.jobId === req.params.id) {
    (req as any).user = { id: payload.userId, role: payload.role, username: "download-token" };
    return handleSingleDownload(req, res);
  }
  return authMiddleware(req, res, () => handleSingleDownload(req, res));
});
runwayRouter.get("/jobs/:id", authMiddleware, (req, res) => ctrl.getJob(req, res));
runwayRouter.post("/jobs/:id/cancel", authMiddleware, (req, res) => ctrl.cancelJob(req, res));
runwayRouter.post("/jobs/:id/retry", authMiddleware, (req, res) => ctrl.retryJob(req, res));
runwayRouter.delete("/jobs/:id", authMiddleware, (req, res) => ctrl.deleteJob(req, res));

// Tags (remark-based)
runwayRouter.get("/tags", authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const role = (req as any).user?.role;
    const where: any = role === "admin"
      ? { remark: { not: null }, status: { not: "deleted" } }
      : { userId, remark: { not: null }, status: { not: "deleted" } };
    const tags = await prisma.runwayJob.groupBy({
      by: ["remark"],
      where,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    });
    res.json(tags.filter(t => t.remark).map(t => ({ tag: t.remark, count: t._count.id })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

runwayRouter.delete("/tags/:tag", authMiddleware, async (req, res) => {
  try {
    const tag = decodeURIComponent(req.params.tag);
    const userId = (req as any).user?.id;
    const role = (req as any).user?.role;
    const where: any = role === "admin"
      ? { remark: tag, status: { not: "deleted" } }
      : { userId, remark: tag, status: { not: "deleted" } };
    // First count
    const count = await prisma.runwayJob.count({ where });
    if (count === 0) return res.status(404).json({ error: "no jobs with this tag" });
    // Soft delete all
    // Preserve finishedAt for completed tasks so deletion does not change generated stats.
    const deleteTime = new Date();
    await prisma.runwayJob.updateMany({
      where: { ...where, finishedAt: null },
      data: { finishedAt: deleteTime },
    });
    const result = await prisma.runwayJob.updateMany({
      where,
      data: { status: "deleted" },
    });
    res.json({ deleted: result.count, tag });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Upload — require auth
const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "mp4", "mov", "avi"]);
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "avi"]);

runwayRouter.post("/upload", authMiddleware, (req, res) => {
  try {
    const { data, filename } = req.body;
    if (!data || typeof data !== "string") return res.status(400).json({ error: "Missing data field" });
    const ext = (filename || "upload.png").split(".").pop()?.toLowerCase() || "png";
    if (!ALLOWED_EXTENSIONS.has(ext)) return res.status(400).json({ error: `不支持的文件格式: .${ext}` });
    const buf = Buffer.from(data.replace(/^data:[^;]+;base64,/, ""), "base64");
    const maxSize = VIDEO_EXTENSIONS.has(ext) ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    if (buf.length > maxSize) return res.status(400).json({ error: `文件过大（${Math.round(buf.length/1024/1024)}MB），上限 ${Math.round(maxSize/1024/1024)}MB` });
    if (buf.length < 1024 && !VIDEO_EXTENSIONS.has(ext)) return res.status(400).json({ error: "图片文件过小，请上传有效图片" });
    const safeName = `upload_${Date.now()}.${ext}`;
    const dest = path.join("/root/runway/uploads", safeName);
    fs.writeFileSync(dest, buf);
    res.json({ url: `/img/${safeName}` });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Capture endpoint (internal, no auth needed)
const captureDir = path.join(process.cwd(), "../../captures");
if (!fs.existsSync(captureDir)) fs.mkdirSync(captureDir, { recursive: true });


// AI Prompt Optimization Proxy (avoids CORS issues with external API)
runwayRouter.post("/ai/optimize", authMiddleware, async (req: any, res: any) => {
  const reqStart = Date.now();
  console.log("[ai/optimize] request received, model:", req.body?.model, "stream:", req.body?.stream, "messages:", req.body?.messages?.length);
  // Log image sizes in user content
  const userMsg = req.body?.messages?.find((m: any) => m.role === "user");
  if (userMsg?.content && Array.isArray(userMsg.content)) {
    const imgCount = userMsg.content.filter((c: any) => c.type === "image_url").length;
    const totalLen = JSON.stringify(userMsg.content).length;
    console.log("[ai/optimize] user content: images=" + imgCount + ", totalPayloadChars=" + totalLen);
  }
  try {
    const fetchMod = await import("node-fetch");
    const fetchFn = fetchMod.default;
    const AbortController = globalThis.AbortController;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000); // 90s timeout
    console.log("[ai/optimize] sending to upstream API, bodySize:", JSON.stringify(req.body).length);
    const apiRes = await fetchFn("https://api.iplcz.cn/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.AI_OPTIMIZE_API_KEY}`,
      },
      body: JSON.stringify(req.body),
      signal: controller.signal as any,
    });
    clearTimeout(timeout);
    console.log("[ai/optimize] upstream responded, status:", apiRes.status, "elapsed:", Date.now() - reqStart, "ms");
    res.writeHead(apiRes.status, {
      "Content-Type": apiRes.headers.get("content-type") || "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    if (apiRes.body) {
      // Body-stream timeout: abort if stalls 90s after headers received
      const bodyTimeout = setTimeout(() => {
        console.error("[ai/optimize] body stream timeout");
        try { (apiRes.body as any).destroy?.(); } catch {}
        // Write SSE error event before closing so frontend knows
        if (!res.writableEnded) {
          try { res.write("data: {\"error\":\"stream_timeout\"}\n\n"); } catch {}
          try { res.end(); } catch {}
        }
      }, 90000);
      (apiRes.body as any).on("error", (err: any) => {
        console.error("[ai/optimize] body stream error:", err.message);
        clearTimeout(bodyTimeout);
        if (!res.writableEnded) { try { res.end(); } catch {} }
      });
      console.log("[ai/optimize] piping body stream to client");
      apiRes.body.pipe(res);
      res.on("finish", () => { clearTimeout(bodyTimeout); console.log("[ai/optimize] stream finished, total elapsed:", Date.now() - reqStart, "ms"); });
      res.on("close", () => { clearTimeout(bodyTimeout); console.log("[ai/optimize] connection closed, total elapsed:", Date.now() - reqStart, "ms"); });
    } else {
      const text = await apiRes.text();
      res.end(text);
    }
  } catch (err: any) {
    console.error("[ai/optimize] error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message || "AI proxy error" });
  }
});

// Admin: prioritize a pending job (move to front of queue)
runwayRouter.post("/jobs/:id/prioritize", authMiddleware, async (req: any, res: any) => {
  try {
    if (req.user!.role !== "admin") {
      return res.status(403).json({ error: "仅管理员可操作" });
    }
    const jobId = req.params.id;
    const { priority = 10 } = req.body || {};

    // Only allow prioritizing pending/queued jobs
    const job = await prisma.runwayJob.findUnique({ where: { id: jobId } }) as any;
    if (!job) return res.status(404).json({ error: "任务不存在" });
    if (!["pending", "queued"].includes(job.status)) {
      return res.status(400).json({ error: "只能优先排队等待中的任务" });
    }

    await prisma.$executeRawUnsafe(
      `UPDATE runway_jobs SET priority = $1 WHERE id = $2::uuid`,
      priority, jobId
    );

    console.log(`[admin] Job ${jobId} priority set to ${priority} by ${req.user!.username}`);
    res.json({ ok: true, priority });
  } catch (err: any) {
    console.error("[prioritize] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Capture: admin-only. Auto-sync-token was removed — token rotation must go through admin UI.
runwayRouter.post("/capture", adminMiddleware, async (req, res) => {
  try {
    const data = req.body;
    const filename = `capture_${Date.now()}.json`;
    const filepath = path.join(captureDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    console.log(`[capture] saved ${filename} by ${req.user!.username}`);
    res.json({ ok: true, saved: filename });
  } catch (e: any) {
    res.status(500).json({ error: "capture save failed" });
  }
});

runwayRouter.get("/capture", adminMiddleware, (req, res) => {
  try {
    const files = fs.readdirSync(captureDir)
      .filter(f => f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, 50);
    const captures = files.map(f => {
      const content = JSON.parse(fs.readFileSync(path.join(captureDir, f), "utf-8"));
      return { file: f, ...content };
    });
    res.json(captures);
  } catch {
    res.json([]);
  }
});

// Token status — require auth (now uses DB accounts instead of env vars)
runwayRouter.get("/token-status", authMiddleware, async (req, res) => {
  try {
    // Per-user active task count and concurrency limit
    const userId = req.user?.id;
    const ACTIVE_STATUSES = ["pending", "queued", "submitted", "processing"];
    const userActiveCount = userId
      ? await prisma.runwayJob.count({ where: { userId, status: { in: ACTIVE_STATUSES } } }).catch(() => 0)
      : 0;
    const userRecord = userId
      ? await prisma.user.findUnique({ where: { id: userId }, select: { maxConcurrency: true, dailyQuota: true, totalQuota: true } }).catch(() => null)
      : null;
    const userMaxConcurrency = userRecord?.maxConcurrency ?? 2;

    // Daily total (includes deleted - deletion does not decrement)
    let dailyUsed = 0;
    let dailyQuotaUsed = 0;
    let systemDailyTotal = 0;
    const dailyQuota = userRecord?.dailyQuota ?? null;
    {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      if (userId) {
        dailyUsed = await prisma.runwayJob.count({ where: { userId, createdAt: { gte: todayStart } } }).catch(() => 0);
        dailyQuotaUsed = await prisma.runwayJob.count({ where: { userId, createdAt: { gte: todayStart }, status: { notIn: ["deleted", "failed", "cancelled"] } } }).catch(() => 0);
      }
      systemDailyTotal = await prisma.runwayJob.count({
        where: {
          finishedAt: { gte: todayStart },
          OR: [
            { status: "completed" },
            { status: "deleted", OR: [{ resultUrl: { not: null } }, { videoUrl: { not: null } }] },
          ],
        },
      }).catch(() => 0);
    }

    // Total quota info
    let totalUsed = 0;
    const totalQuota = userRecord?.totalQuota ?? null;
    if (userId && totalQuota !== null) {
      totalUsed = await prisma.runwayJob.count({ where: { userId } }).catch(() => 0);
    }

    // Get account info from DB instead of env vars
    const accounts = await prisma.runwayAccount.findMany({
      where: { isActive: true },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });

    const tokens = await Promise.all(accounts.map(async (a, idx) => {
      const cooled = await redisConnection.get(`account:cooldown:${a.id}`).catch(() => null);
      const cooldownTtl = cooled ? await redisConnection.ttl(`account:cooldown:${a.id}`).catch(() => 0) : 0;
      const current = await redisConnection.get(`account:concurrency:${a.id}`).catch(() => null);

      // Decode JWT exp if token is a JWT
      let expiresAt: string | null = null;
      let expiresInDays: number | null = null;
      let expiringSoon = false;
      if (a.tokenExpiresAt) {
        expiresAt = a.tokenExpiresAt.toISOString();
        expiresInDays = Math.round((a.tokenExpiresAt.getTime() - Date.now()) / 86400000);
        expiringSoon = expiresInDays < 7;
      }

      return {
        id: a.id,
        label: a.label,
        tokenShort: a.tokenShort,
        teamId: a.teamId,
        index: idx + 1,
        expiresAt,
        expiresInDays,
        expiringSoon,
        inCooldown: !!cooled,
        cooldownTtl,
        maxConcurrency: a.maxConcurrency,
        currentConcurrency: current ? parseInt(current, 10) : 0,
      };
    }));

    res.json({
      tokens,
      count: tokens.length,
      activeTasks: userActiveCount,
      maxConcurrency: userMaxConcurrency,
      dailyUsed,
      dailyQuotaUsed,
      systemDailyTotal,
      dailyQuota,
      totalUsed,
      totalQuota,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});
// ============================================================
// Seedream 5.0 routes — direct API (taskType: seedream_5)
// Appended to runway.ts. Requires: prisma, authMiddleware, fetch (node-fetch already imported dynamically in this file).
// ============================================================

async function _runwayFetch(path: string, init: any, account: any) {
  const fetchMod = await import("node-fetch");
  const fetch: any = (fetchMod as any).default || fetchMod;
  const headers = {
    "Authorization": `Bearer ${account.token}`,
    "Content-Type": "application/json",
    "X-Runway-Workspace": account.teamId,
    ...(init.headers || {}),
  };
  let agent: any;
  if (account.proxyUrl) {
    try {
      if (account.proxyUrl.startsWith("socks")) {
        const { SocksProxyAgent } = await import("socks-proxy-agent");
        agent = new SocksProxyAgent(account.proxyUrl);
      } else {
        const { HttpsProxyAgent } = await import("https-proxy-agent");
        agent = new HttpsProxyAgent(account.proxyUrl);
      }
    } catch {}
  }
  const res = await fetch(`https://api.runwayml.com${path}`, { ...init, headers, ...(agent ? { agent } : {}) });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, json, text };
}

function _isTokenRevokedResponse(status: number, text: string): boolean {
  return status === 401 && /revoked|expired|invalid|unauthorized|jwt/i.test(text || "");
}

function _isSafetyModerationResponse(status: number, text: string): boolean {
  return /SAFETY\.|moderation|content policy|risk control|SEXUALLY_EXPLICIT|VIOLENCE|prohibited|safety|内容审核|未通过审核|暴力|色情/i.test(`${status} ${text || ""}`);
}

async function _recordDirectRunwayError(account: any, context: string, status: number, text: string) {
  const message = `${context} ${status}: ${String(text || "").slice(0, 300)}`;
  const isRevoked = _isTokenRevokedResponse(status, text);
  const isSafety = _isSafetyModerationResponse(status, text);
  let shouldDisable = isRevoked;
  let safetyCount = 0;
  if (isSafety && account?.id) {
    if (await isContentReviewEnabled()) {
      const key = `account:safety-failures:${account.id}`;
      safetyCount = await redisConnection.incr(key).catch(() => 0);
      if (safetyCount === 1) await redisConnection.expire(key, SAFETY_FAILURE_WINDOW_SECONDS).catch(() => {});
      shouldDisable = shouldDisable || safetyCount >= SAFETY_FAILURE_DAILY_LIMIT;
    } else {
      console.warn(`[runway:direct] content review disabled, safety failure recorded without disabling ${String(account.id).slice(0,8)}`);
    }
  }
  await prisma.runwayAccount.update({
    where: { id: account.id },
    data: {
      ...(shouldDisable ? { isActive: false } : {}),
      lastErrorAt: new Date(),
      lastErrorMessage: isRevoked
        ? `token invalid/revoked: ${message}`
        : isSafety
          ? (safetyCount > 0 ? `safety failure ${safetyCount}/${SAFETY_FAILURE_DAILY_LIMIT}: ${message}` : message)
          : message,
    },
  }).catch(() => {});
  if (shouldDisable) {
    await redisConnection.del(`account:concurrency:${account.id}`, `account:cooldown:${account.id}`).catch(() => {});
    console.warn(`[runway:direct] auto-disabled ${String(account.id).slice(0,8)}: ${message}`);
  }
}

async function _pickSeedreamAccount() {
  const accounts = await prisma.runwayAccount.findMany({
    where: { isActive: true },
    orderBy: [{ priority: "desc" }, { lastUsedAt: "asc" }],
  });
  return accounts[0] || null;
}

// POST /api/runway/seedream/upload — upload reference image to Runway CDN (3-step flow)
runwayRouter.post("/seedream/upload", authMiddleware, async (req: any, res: any) => {
  try {
    const { data, filename } = req.body || {};
    if (!data || typeof data !== "string") return res.status(400).json({ error: "缺少 data" });
    const safeName = filename || `upload_${Date.now()}.png`;
    const ext = safeName.split(".").pop()?.toLowerCase() || "png";
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
               : ext === "webp" ? "image/webp"
               : ext === "gif" ? "image/gif"
               : "image/png";
    const buf = Buffer.from(data.replace(/^data:[^;]+;base64,/, ""), "base64");
    if (buf.length < 512) return res.status(400).json({ error: "图片过小" });
    if (buf.length > 10 * 1024 * 1024) return res.status(400).json({ error: "图片过大（>10MB）" });

    const account = await _pickSeedreamAccount();
    if (!account) return res.status(503).json({ error: "无可用账号" });

    // Step 1: request upload URL
    console.log("[seedream:log] POST /v1/uploads filename:", safeName);
    const r1 = await _runwayFetch("/v1/uploads", {
      method: "POST",
      body: JSON.stringify({ filename: safeName, numberOfParts: 1, type: "DATASET" }),
    }, account);
    console.log("[seedream:log] /v1/uploads status:", r1.status, "body:", r1.text.slice(0,400));
    if (!r1.ok) {
      await _recordDirectRunwayError(account, "seedream upload", r1.status, r1.text);
      return res.status(502).json({ error: `上传失败 ${r1.status}`, detail: r1.text.slice(0, 500) });
    }
    const uploadId = r1.json?.id;
    const uploadUrl = r1.json?.uploadUrls?.[0];
    const uploadHeaders = r1.json?.uploadHeaders || { "Content-Type": mime };
    if (!uploadId || !uploadUrl) return res.status(502).json({ error: "未返回 uploadUrls" });

    // Step 2: PUT bytes to presigned S3
    const fetchMod = await import("node-fetch");
    const fetch: any = (fetchMod as any).default || fetchMod;
    let agent: any;
    if (account.proxyUrl) {
      try {
        if (account.proxyUrl.startsWith("socks")) {
          const { SocksProxyAgent } = await import("socks-proxy-agent");
          agent = new SocksProxyAgent(account.proxyUrl);
        } else {
          const { HttpsProxyAgent } = await import("https-proxy-agent");
          agent = new HttpsProxyAgent(account.proxyUrl);
        }
      } catch {}
    }
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: uploadHeaders,
      body: buf,
      ...(agent ? { agent } : {}),
    });
    if (!putRes.ok) {
      const t = await putRes.text().catch(() => "");
      return res.status(502).json({ error: `S3 PUT ${putRes.status}`, detail: t.slice(0, 300) });
    }
    const etag = (putRes.headers.get("etag") || putRes.headers.get("ETag") || "").replace(/^"|"$/g, "");
    if (!etag) return res.status(502).json({ error: "S3 未返回 ETag" });

    // Step 3: complete upload
    const r3 = await _runwayFetch(`/v1/uploads/${uploadId}/complete`, {
      method: "POST",
      body: JSON.stringify({ parts: [{ PartNumber: 1, ETag: etag }] }),
    }, account);
    if (!r3.ok) {
      await _recordDirectRunwayError(account, "seedream upload complete", r3.status, r3.text);
      return res.status(502).json({ error: `complete 失败 ${r3.status}`, detail: r3.text.slice(0, 500) });
    }
    const cdnUrl = r3.json?.url;
    if (!cdnUrl) return res.status(502).json({ error: "未返回 CDN url" });

    res.json({ ok: true, assetId: uploadId, url: cdnUrl, filename: safeName });
  } catch (e: any) {
    console.error("[seedream:upload]", e);
    res.status(500).json({ error: e.message || "上传失败" });
  }
});

// POST /api/runway/seedream — create Seedream 5.0 task
runwayRouter.post("/seedream", authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "未登录" });
    const { prompt, aspectRatio, resolution, numImages, exploreMode, referenceImages, name } = req.body || {};
    if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: "提示词不能为空" });
    const promptError = await validateDirectRunwayPrompt(userId, prompt, "seedream");
    if (promptError) return res.status(400).json({ error: promptError });
    const ar = aspectRatio || "1:1";
    const rs = resolution || "2k";
    const n = Math.max(1, Math.min(4, Number(numImages) || 1));

    const account = await _pickSeedreamAccount();
    if (!account) return res.status(503).json({ error: "无可用账号" });

    const { randomUUID } = await import("crypto");
    const options: any = {
      name: name || `Seedream 50 - ${String(prompt).slice(0, 20)}`,
      prompt: String(prompt),
      aspectRatio: ar,
      resolution: rs,
      numImages: n,
      exploreMode: exploreMode === true,
      creationSource: "tool-mode",
    };
    if (Array.isArray(referenceImages) && referenceImages.length > 0) {
      options.referenceImages = referenceImages
        .filter((r: any) => r && r.assetId && r.url)
        .map((r: any, i: number) => ({
          tag: r.tag || `IMG_${i + 1}`,
          url: r.url,
          assetId: r.assetId,
        }));
    }

    const body = { taskType: "seedream_5", asTeamId: Number(account.teamId), options };
    console.log("[seedream:log] POST /v1/tasks body:", JSON.stringify(body).slice(0,800));
    const r = await _runwayFetch("/v1/tasks", { method: "POST", body: JSON.stringify(body) }, account);
    console.log("[seedream:log] /v1/tasks status:", r.status, "body:", r.text.slice(0,500));
    if (!r.ok) {
      await _recordDirectRunwayError(account, "seedream create", r.status, r.text);
      return res.status(502).json({ error: `API ${r.status}`, detail: r.text.slice(0, 500) });
    }
    const remoteTaskId = r.json?.id || r.json?.task?.id || r.json?.taskId;
    if (!remoteTaskId) return res.status(502).json({ error: "未返回 taskId", raw: r.json });

    const row = await prisma.seedreamJob.create({
      data: {
        userId,
        accountId: account.id,
        remoteTaskId,
        status: "pending",
        prompt: String(prompt),
        aspectRatio: ar,
        resolution: rs,
        numImages: n,
        exploreMode: options.exploreMode,
        referenceImages: options.referenceImages || null,
      },
    });
    await prisma.runwayAccount.update({ where: { id: account.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    res.json({ ok: true, job: row });
  } catch (e: any) {
    console.error("[seedream:create][seedream:log]", e);
    res.status(500).json({ error: e.message || "创建失败" });
  }
});

// GET /api/runway/seedream — list current user's Seedream jobs
runwayRouter.get("/seedream", authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === "admin";
    const limit = Math.min(200, Number(req.query.limit) || 100);
    const rows = await prisma.seedreamJob.findMany({
      where: isAdmin ? {} : { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    res.json({ ok: true, jobs: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/runway/seedream/:id — refresh status from Runway if not terminal
runwayRouter.get("/seedream/:id", authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === "admin";
    const row = await prisma.seedreamJob.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: "未找到" });
    if (!isAdmin && row.userId !== userId) return res.status(403).json({ error: "无权限" });

    if (row.status !== "SUCCEEDED" && row.status !== "FAILED" && row.remoteTaskId && row.accountId) {
      const account = await prisma.runwayAccount.findUnique({ where: { id: row.accountId } });
      if (account) {
        const r = await _runwayFetch(`/v1/tasks/${row.remoteTaskId}?asTeamId=${account.teamId}`, { method: "GET" }, account);
        if (r.ok && r.json) {
          const t = r.json.task || r.json;
          const status = (t.status || "").toUpperCase();
          let images: any = null;
          let err: string | null = null;
          if (status === "SUCCEEDED") {
            const artifacts = t.artifacts || t.output || [];
            images = artifacts.map((a: any, i: number) => ({ index: i, url: a.url || a.imageUrl || a }));
          } else if (status === "FAILED") {
            err = t.errorMessage || t.error || "任务失败";
          }
          const updated = await prisma.seedreamJob.update({
            where: { id: row.id },
            data: {
              status: status || row.status,
              images: images || (row.images as any),
              errorMessage: err || row.errorMessage,
            },
          });
          // review.engine hook — fire-and-forget
          try {
            if (status === "SUCCEEDED" && images && images[0]?.url) {
              const eng = await import("../services/review.engine");
              eng.onSeedreamCompleted(row.id, images[0].url).catch((e:any)=>console.error("[review hook]",e?.message));
            } else if (status === "FAILED") {
              const eng = await import("../services/review.engine");
              eng.onSeedreamFailed?.(row.id).catch?.(()=>{});
            }
          } catch (e:any) { console.error("[review hook] import error", e?.message); }
          return res.json({ ok: true, job: updated });
        } else if (!r.ok) {
          await _recordDirectRunwayError(account, "seedream poll", r.status, r.text);
        }
      }
    }
    res.json({ ok: true, job: row });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/runway/seedream/:id
runwayRouter.delete("/seedream/:id", authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === "admin";
    const row = await prisma.seedreamJob.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: "未找到" });
    if (!isAdmin && row.userId !== userId) return res.status(403).json({ error: "无权限" });
    await prisma.seedreamJob.delete({ where: { id: row.id } });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// Runway Video routes — direct API (taskType: gen4 / gen4_turbo)
// ============================================================

async function _pickVideoAccount() {
  const accounts = await prisma.runwayAccount.findMany({
    where: { isActive: true },
    orderBy: [{ priority: "desc" }, { lastUsedAt: "asc" }],
  });
  return accounts[0] || null;
}

async function _uploadAssetToRunway(account: any, dataUrl: string, filename: string) {
  const safeName = filename || `upload_${Date.now()}.png`;
  const ext = safeName.split(".").pop()?.toLowerCase() || "png";
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
             : ext === "webp" ? "image/webp"
             : ext === "gif" ? "image/gif"
             : "image/png";
  const buf = Buffer.from(String(dataUrl).replace(/^data:[^;]+;base64,/, ""), "base64");
  if (buf.length < 512) throw new Error("image too small");
  if (buf.length > 10 * 1024 * 1024) throw new Error("image too large");

  const r1 = await _runwayFetch("/v1/uploads", {
    method: "POST",
    body: JSON.stringify({ filename: safeName, numberOfParts: 1, type: "DATASET" }),
  }, account);
  if (!r1.ok) {
    await _recordDirectRunwayError(account, "video upload", r1.status, r1.text);
    throw new Error(`upload failed ${r1.status}: ${r1.text.slice(0,300)}`);
  }
  const uploadId = r1.json?.id;
  const uploadUrl = r1.json?.uploadUrls?.[0];
  const uploadHeaders = r1.json?.uploadHeaders || { "Content-Type": mime };
  if (!uploadId || !uploadUrl) throw new Error("no uploadUrls");

  const fetchMod = await import("node-fetch");
  const fetch: any = (fetchMod as any).default || fetchMod;
  let agent: any;
  if (account.proxyUrl) {
    try {
      if (account.proxyUrl.startsWith("socks")) {
        const { SocksProxyAgent } = await import("socks-proxy-agent");
        agent = new SocksProxyAgent(account.proxyUrl);
      } else {
        const { HttpsProxyAgent } = await import("https-proxy-agent");
        agent = new HttpsProxyAgent(account.proxyUrl);
      }
    } catch {}
  }
  const putRes = await fetch(uploadUrl, { method: "PUT", headers: uploadHeaders, body: buf, ...(agent ? { agent } : {}) });
  if (!putRes.ok) {
    const t = await putRes.text().catch(() => "");
    throw new Error(`S3 PUT ${putRes.status}: ${t.slice(0,200)}`);
  }
  const etag = (putRes.headers.get("etag") || putRes.headers.get("ETag") || "").replace(/^"|"$/g, "");
  if (!etag) throw new Error("S3 no ETag");

  const r3 = await _runwayFetch(`/v1/uploads/${uploadId}/complete`, {
    method: "POST",
    body: JSON.stringify({ parts: [{ PartNumber: 1, ETag: etag }] }),
  }, account);
  if (!r3.ok) {
    await _recordDirectRunwayError(account, "video upload complete", r3.status, r3.text);
    throw new Error(`complete failed ${r3.status}: ${r3.text.slice(0,300)}`);
  }
  const cdnUrl = r3.json?.url;
  if (!cdnUrl) throw new Error("no CDN url");
  return { assetId: uploadId, url: cdnUrl, filename: safeName };
}

runwayRouter.post("/video/upload", authMiddleware, async (req: any, res: any) => {
  try {
    const { data, filename } = req.body || {};
    if (!data || typeof data !== "string") return res.status(400).json({ error: "missing data" });
    const account = await _pickVideoAccount();
    if (!account) return res.status(503).json({ error: "no available account" });
    const out = await _uploadAssetToRunway(account, data, filename);
    res.json({ ok: true, ...out });
  } catch (e: any) {
    console.error("[video:upload]", e);
    res.status(500).json({ error: e.message || "upload failed" });
  }
});

function _ratioToWH(ratio: string): { width: number; height: number } {
  if (ratio === "9:16") return { width: 720, height: 1280 };
  if (ratio === "1:1") return { width: 960, height: 960 };
  return { width: 1280, height: 720 };
}

runwayRouter.post("/video", authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    const {
      prompt,
      mode,
      model: modelIn,
      ratio: ratioIn,
      seconds: secondsIn,
      referenceImage,
      seed: seedIn,
      watermark,
      exploreMode,
      name,
    } = req.body || {};
    if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: "prompt required" });
    const promptError = await validateDirectRunwayPrompt(userId, prompt, "video");
    if (promptError) return res.status(400).json({ error: promptError });
    if (mode !== "text_to_video" && mode !== "image_to_video") return res.status(400).json({ error: "mode must be text_to_video or image_to_video" });
    const model = modelIn === "gen4" ? "gen4" : "gen4_turbo";
    const ratio = ratioIn === "9:16" || ratioIn === "1:1" ? ratioIn : "16:9";
    const seconds = Number(secondsIn) === 10 ? 10 : 5;
    if (mode === "image_to_video") {
      if (!referenceImage || !referenceImage.assetId || !referenceImage.url) {
        return res.status(400).json({ error: "image_to_video requires referenceImage assetId/url" });
      }
    }
    const { width, height } = _ratioToWH(ratio);

    const account = await _pickVideoAccount();
    if (!account) return res.status(503).json({ error: "no available account" });

    const { randomUUID, randomInt } = await import("crypto");
    const seed = Number.isFinite(Number(seedIn)) ? Number(seedIn) : randomInt(1, 4294967295);

    const options: any = {
      name: name || `${model === "gen4_turbo" ? "Gen-4 Turbo" : "Gen-4"} - ${String(prompt).slice(0, 40)}`,
      text_prompt: String(prompt),
      seconds,
      width,
      height,
      seed,
      watermark: !!watermark,
      exploreMode: exploreMode === true,
      assetGroupId: randomUUID(),
      creationSource: "tool-mode",
      route: mode === "image_to_video" ? "i2v" : "t2v",
    };
    if (mode === "image_to_video") {
      options.init_image = referenceImage.url;
      options.imageAssetId = referenceImage.assetId;
    }

    const body = {
      taskType: model,
      asTeamId: Number(account.teamId),
      sessionId: randomUUID(),
      options,
    };
    console.log("[video:log] POST /v1/tasks body:", JSON.stringify(body).slice(0, 800));
    const r = await _runwayFetch("/v1/tasks", { method: "POST", body: JSON.stringify(body) }, account);
    console.log("[video:log] /v1/tasks status:", r.status, "body:", r.text.slice(0, 500));
    if (!r.ok) {
      await _recordDirectRunwayError(account, "video create", r.status, r.text);
      return res.status(502).json({ error: `API ${r.status}`, detail: r.text.slice(0, 500) });
    }
    const remoteTaskId = r.json?.id || r.json?.task?.id || r.json?.taskId;
    if (!remoteTaskId) return res.status(502).json({ error: "no taskId", raw: r.json });

    const row = await (prisma as any).runwayVideoJob.create({
      data: {
        userId,
        accountId: account.id,
        remoteTaskId,
        status: "pending",
        prompt: String(prompt),
        mode,
        model,
        ratio,
        seconds,
        seed,
        watermark: !!watermark,
        exploreMode: options.exploreMode,
        referenceImage: mode === "image_to_video" ? { assetId: referenceImage.assetId, url: referenceImage.url } : null,
      },
    });
    await prisma.runwayAccount.update({ where: { id: account.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    res.json({ ok: true, job: row });
  } catch (e: any) {
    console.error("[video:create]", e);
    res.status(500).json({ error: e.message || "create failed" });
  }
});

runwayRouter.get("/video", authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === "admin";
    const limit = Math.min(200, Number(req.query.limit) || 100);
    const rows = await (prisma as any).runwayVideoJob.findMany({
      where: isAdmin ? {} : { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    res.json({ ok: true, jobs: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

runwayRouter.get("/video/:id", authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === "admin";
    const row = await (prisma as any).runwayVideoJob.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: "not found" });
    if (!isAdmin && row.userId !== userId) return res.status(403).json({ error: "forbidden" });

    const terminal = ["SUCCEEDED", "FAILED", "CANCELED"];
    if (!terminal.includes(row.status) && row.remoteTaskId && row.accountId) {
      const account = await prisma.runwayAccount.findUnique({ where: { id: row.accountId } });
      if (account) {
        const r = await _runwayFetch(`/v1/tasks/${row.remoteTaskId}?asTeamId=${account.teamId}`, { method: "GET" }, account);
        if (r.ok && r.json) {
          const t = r.json.task || r.json;
          const upStatus = (t.status || "").toUpperCase();
          let mapped = row.status;
          if (upStatus === "THROTTLED" || upStatus === "PENDING") mapped = "pending";
          else if (upStatus === "RUNNING") mapped = "RUNNING";
          else if (upStatus === "SUCCEEDED") mapped = "SUCCEEDED";
          else if (upStatus === "FAILED") mapped = "FAILED";
          else if (upStatus === "CANCELED") mapped = "CANCELED";
          let videoUrl: string | null = row.videoUrl;
          let err: string | null = row.errorMessage;
          if (mapped === "SUCCEEDED") {
            const artifacts = t.artifacts || t.output || [];
            const first = Array.isArray(artifacts) ? artifacts[0] : null;
            videoUrl = (first && (first.url || first)) || null;
          } else if (mapped === "FAILED") {
            err = t.errorMessage || t.error || "task failed";
          }
          const updated = await (prisma as any).runwayVideoJob.update({
            where: { id: row.id },
            data: { status: mapped, videoUrl, errorMessage: err },
          });
          return res.json({ ok: true, job: updated });
        } else if (!r.ok) {
          await _recordDirectRunwayError(account, "video poll", r.status, r.text);
        }
      }
    }
    res.json({ ok: true, job: row });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
