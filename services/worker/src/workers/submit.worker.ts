import { Worker, Job, Queue } from "bullmq";
import crypto from "crypto";
import { RunwayDirectClient } from "../services/runway.direct";
import { prisma, redis as connection, accountPool } from "../services/shared";
import type { AccountEntry } from "../services/account-pool";
import { translateRunwayError } from '../utils/errorTranslator';

const JOB_HISTORY_LIMIT = Number(process.env.BULLMQ_HISTORY_LIMIT) || 1000;
const defaultJobOptions = { removeOnComplete: true, removeOnFail: JOB_HISTORY_LIMIT };
const pollQueue = new Queue("runway-poll", { connection, defaultJobOptions });
const submitQueue = new Queue("runway-submit", { connection, defaultJobOptions });
const PROMPT_GUARD_ENABLED = process.env.RUNWAY_PROMPT_GUARD_ENABLED !== "false";
const CONTENT_REVIEW_KEY = "runway:content-review-enabled";
const WORKER_TEMPLATE_LIMIT_PER_HOUR = Math.max(1, Number(process.env.RUNWAY_WORKER_TEMPLATE_LIMIT_PER_HOUR) || 10);
const GLOBAL_WORKER_TEMPLATE_LIMIT_PER_HOUR = Math.max(1, Number(process.env.RUNWAY_GLOBAL_TEMPLATE_LIMIT_PER_HOUR) || WORKER_TEMPLATE_LIMIT_PER_HOUR);
const WORKER_TEMPLATE_WINDOW_SECONDS = Math.max(300, Number(process.env.RUNWAY_TEMPLATE_WINDOW_SECONDS) || 3600);
const WORKER_GLOBAL_SUBMIT_LIMIT_PER_HOUR = Math.max(1, Number(process.env.RUNWAY_WORKER_GLOBAL_SUBMIT_LIMIT_PER_HOUR) || 30);
const RELAXED_TEMPLATE_LIMIT_PER_HOUR = Math.max(1, Number(process.env.RUNWAY_RELAXED_TEMPLATE_LIMIT_PER_HOUR) || 25);
const RELAXED_GLOBAL_TEMPLATE_LIMIT_PER_HOUR = Math.max(1, Number(process.env.RUNWAY_RELAXED_GLOBAL_TEMPLATE_LIMIT_PER_HOUR) || 40);
const PENDING_CANDIDATE_LIMIT = Math.max(10, Number(process.env.RUNWAY_PENDING_CANDIDATE_LIMIT) || 500);
const STALE_LOCAL_SUBMIT_MINUTES = Math.max(2, Number(process.env.RUNWAY_STALE_LOCAL_SUBMIT_MINUTES) || 8);
const BORROWED_STALE_SUBMIT_MINUTES = Math.max(1, Number(process.env.RUNWAY_BORROWED_STALE_SUBMIT_MINUTES) || 2);
const RATE_LIMIT_WINDOW_SECONDS = Math.max(60, Number(process.env.RUNWAY_RATE_LIMIT_WINDOW_SECONDS) || 300);
const RATE_LIMIT_GLOBAL_THRESHOLD = Math.max(2, Number(process.env.RUNWAY_RATE_LIMIT_GLOBAL_THRESHOLD) || 6);
const RATE_LIMIT_GLOBAL_COOLDOWN_SECONDS = Math.max(30, Number(process.env.RUNWAY_RATE_LIMIT_GLOBAL_COOLDOWN_SECONDS) || 120);

const LEGACY_GUARD_BEFORE = process.env.RUNWAY_LEGACY_PROMPT_GUARD_BEFORE
  ? Date.parse(process.env.RUNWAY_LEGACY_PROMPT_GUARD_BEFORE)
  : 0;
const STRICT_MINOR_GUARD = process.env.RUNWAY_ALLOW_MINOR_PROMPTS !== "true";

type PromptRisk = { blocked: boolean; reason?: string; keywords?: string[] };
type GuardProfile = "seedance" | "kling" | "legacy" | "default";

function getGuardProfile(modelName?: string | null, createdAt?: Date | string | null): GuardProfile {
  if (LEGACY_GUARD_BEFORE > 0 && createdAt) {
    const ts = new Date(createdAt).getTime();
    if (Number.isFinite(ts) && ts < LEGACY_GUARD_BEFORE) return "legacy";
  }
  const model = String(modelName || "").toLowerCase();
  if (model.includes("seedance")) return "seedance";
  if (model.includes("kling")) return "kling";
  return "default";
}

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

function inspectPromptRisk(prompt: unknown, profile: GuardProfile = "default"): PromptRisk {
  if (!PROMPT_GUARD_ENABLED) return { blocked: false };
  const text = String(prompt || "").toLowerCase();
  const evasion = /\b(bypass|jailbreak|uncensored|unfiltered|no censorship|ignore policy|ignore safety|no limits?|no restrictions?)\b|\u7ed5\u8fc7.*\u5ba1\u6838|\u7ed5\u8fc7.*\u5ba1\u67e5|\u65e0\u9650\u5236|\u4e0d\u8981\u9650\u5236/i;
  const prohibited = /\b(nsfw|nude|naked|nudity|porn|pornographic|erotic|rape|raped|sexual assault|suicide|self[- ]?harm|gore|gory|graphic blood)\b|\u8272\u60c5|\u88f8|\u88f8\u7167|\u5f3a\u5978|\u6027\u4fb5|\u81ea\u6740|\u81ea\u6b8b|\u8840\u8165/i;
  const sexualHard = /\b(sexual|lingerie|underwear|bikini|cleavage|breasts?|boobs?|nipples?|bra|panties|thong|see[- ]?through|revealing|big breasts?|large breasts?|butt|buttocks|\bass\b|fetish|intimate|adult|voyeur|non[- ]?consensual)\b|\u5185\u8863|\u6bd4\u57fa\u5c3c|\u4e73\u6c9f|\u4e73\u623f|\u7fd8\u81c0|\u4e30\u6ee1\u80f8|\u4e30\u6ee1\u81c0|\u6210\u4eba|\u672a\u7ecf\u540c\u610f/i;
  const sexualSoft = /\b(sexy|sensual|seductive|provocative|swimsuit|curvy|hourglass|slim waist|wide hips?)\b|\u6027\u611f|\u8bf1\u60d1|\u80f8|\u81c0/i;
  const sexualCostume = /\b(maid outfit|french maid|schoolgirl outfit|tight top|bodycon|corset|latex outfit|fetish outfit)\b|\u5973\u4ec6\u88c5|\u5973\u4f63\u88c5|\u8377\u53f6\u8fb9\u5973\u4ec6|\u7d27\u8eab\u4e0a\u8863|\u7d27\u8eab\u88d9|\u60c5\u8da3|\u5236\u670d\u8bf1\u60d1/i;
  const sexual = new RegExp(`(?:${sexualHard.source})|(?:${sexualSoft.source})|(?:${sexualCostume.source})`, "i");
  const violenceHard = /\b(violent|violence|blood|bloody|blood splatter|kill|killing|murder|gun|shoot|shooting|knife|stab|stabbing|wound|wounded|injur(?:y|ed)|corpse|dead body|death|explosion|war|torture|crush|burn(?:ing)?|terroris[mt]|extremis[mt]|dismember|behead|beheading|mutilat(?:e|ed|ion)|organs?|bones?|abuse)\b|\u66b4\u529b|\u8840|\u6d41\u8840|\u6740|\u67aa|\u5200|\u4f24\u53e3|\u5c38\u4f53|\u6b7b\u4ea1|\u7206\u70b8|\u6218\u4e89|\u6050\u6016|\u8650\u5f85|\u80a2\u89e3|\u65a9\u9996|\u65ad\u5934|\u5668\u5b98|\u9aa8\u5934|\u6050\u6016\u4e3b\u4e49|\u6781\u7aef\u4e3b\u4e49/i;
  const violenceSoft = /\b(fight|fighting|pain|suffering|struggl(?:e|ing)|scream(?:ing)?|crying)\b|\u6253\u6597|\u75db\u82e6|\u6323\u624e|\u54ed\u95f9|\u6495\u788e/i;
  const violence = new RegExp(`(?:${violenceHard.source})|(?:${violenceSoft.source})`, "i");
  const minor = /\b(child|children|kid|kids|toddler|minor|minors|baby|babies|teen|teens|teenage|teenager|teenagers|underage|under 18|schoolgirl|schoolboy|young girl|young boy)\b|\u513f\u7ae5|\u5c0f\u5b69|\u5e7c\u513f|\u5b69\u5b50|\u672a\u6210\u5e74|\u5b9d\u5b9d|\u5a74\u513f/i;
  const hateHarassment = /\b(hate speech|racist|slur|nazi|kkk|harass(?:ment)?|bully|bullying|defame|defamation|intimidat(?:e|ion))\b|\u4ec7\u6068|\u6b67\u89c6|\u7eb3\u7cb9|\u9a9a\u6270|\u9738\u51cc|\u8fb1\u9a82|\u8bfd\u8c24/i;
  const deceptionRights = /\b(deepfake|face[- ]?swap|impersonat(?:e|ion)|celebrity|public figure|politician|president|living artist|style of .*artist)\b|\u6362\u8138|\u6df1\u5ea6\u4f2a\u9020|\u5192\u5145|\u8bef\u5bfc|\u540d\u4eba|\u660e\u661f|\u516c\u4f17\u4eba\u7269|\u653f\u6cbb\u4eba\u7269|\u603b\u7edf|\u5728\u4e16\u827a\u672f\u5bb6/i;
  const illegal = /\b(drug|drugs|cocaine|meth|weapon making|bomb making|scam|fraud|phishing)\b|\u6bd2\u54c1|\u5438\u6bd2|\u8d29\u6bd2|\u70b8\u5f39|\u8bc8\u9a97|\u9493\u9c7c|\u8fdd\u6cd5/i;
  const protectedAttribute = /\b(black|white|asian|latino|african|caucasian|race|racial|ethnicity|ethnic|skin color|gender|male|female|man|woman|transgender|trans|non[- ]?binary|gay|lesbian|pregnant|pregnancy|disabled|disability|elderly)\b|\u9ed1\u4eba|\u767d\u4eba|\u4e9a\u88d4|\u6b27\u7f8e|\u79cd\u65cf|\u80a4\u8272|\u6c11\u65cf|\u7537\u6027|\u5973\u6027|\u7537\u4eba|\u5973\u4eba|\u8de8\u6027\u522b|\u53d8\u6027|\u540c\u6027\u604b|\u5b55\u5987|\u6000\u5b55|\u5927\u809a\u5b50|\u8001\u5e74|\u6b8b\u75be/i;
  const identityTransform = /\b(change|replace|swap|turn|convert|transform|make)\b.{0,80}\b(to|into|as)\b|\b(change|replace|swap|turn|convert|transform)\b|\u628a.{0,80}(\u6362\u6210|\u6539\u6210|\u53d8\u6210|\u66ff\u6362\u6210)|\u66f4\u6539.{0,80}(\u4e3a|\u6210)|\u4fee\u6539.{0,80}(\u4e3a|\u6210)|\u4eba\u7269\u4fee\u6539|\u6362\u6210/i;
  const degradingContext = /\b(trash|garbage|dumpster|stink|stinky|dirty|filthy|humiliat(?:e|ing|ion)|degrad(?:e|ing)|slave|servant)\b|\u5783\u573e|\u5783\u573e\u6876|\u81ed\u6c14|\u81ed\u6c14\u718f\u5929|\u810f|\u80ae\u810f|\u5974|\u4f63\u4eba|\u4ec6\u4eba|\u7f9e\u8fb1|\u4fae\u8fb1/i;
  const pregnancy = /\b(pregnant|pregnancy|maternity|expecting mother)\b|\u5b55\u5987|\u6000\u5b55|\u5927\u809a\u5b50|\u4ea7\u5987/i;
  const relaxed = profile === "kling" || profile === "legacy";
  if (evasion.test(text)) return blockedRisk("safety-evasion or uncensored wording", text, evasion);
  if (prohibited.test(text)) return blockedRisk("prohibited sexual/graphic/self-harm keyword", text, prohibited);
  if (minor.test(text) && (sexual.test(text) || violence.test(text))) return blockedRisk("minor combined with sexual or violent context", text, minor, sexual, violence);
  if (profile === "seedance" && STRICT_MINOR_GUARD && minor.test(text)) return blockedRisk("child/minor keyword blocked by seedance strict guard", text, minor);
  if (profile === "seedance" && pregnancy.test(text)) return blockedRisk("pregnancy sensitive person keyword blocked by seedance strict guard", text, pregnancy);
  if (protectedAttribute.test(text) && identityTransform.test(text)) return blockedRisk("protected attribute identity transformation", text, protectedAttribute, identityTransform);
  if (protectedAttribute.test(text) && (sexual.test(text) || degradingContext.test(text))) return blockedRisk("protected attribute combined with sexualized or degrading context", text, protectedAttribute, sexualCostume, degradingContext);
  if (sexualCostume.test(text)) return blockedRisk("sexualized costume keyword", text, sexualCostume);
  if (relaxed ? sexualHard.test(text) : sexual.test(text)) return blockedRisk("sexualized body or adult keyword", text, relaxed ? sexualHard : sexual);
  if (relaxed ? violenceHard.test(text) : violence.test(text)) return blockedRisk("violent distress or injury keyword", text, relaxed ? violenceHard : violence);
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
  if (r.includes("protected attribute")) return "包含种族、性别、孕妇等受保护属性替换或敏感组合";
  if (r.includes("pregnancy")) return "包含孕妇/怀孕相关敏感人物设定";
  if (r.includes("sexualized costume")) return "包含女仆装、紧身服等性化服装或角色设定";
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
  const raw = await connection.get(CONTENT_REVIEW_KEY).catch(() => null);
  return raw === null ? true : raw === "1";
}

async function checkWorkerTemplateBurst(accountId: string, userId: string | null | undefined, prompt: unknown, profile: GuardProfile): Promise<string | null> {
  const hash = promptTemplateHash(prompt);
  const relaxed = profile === "kling" || profile === "legacy";
  const perAccountLimit = relaxed ? RELAXED_TEMPLATE_LIMIT_PER_HOUR : WORKER_TEMPLATE_LIMIT_PER_HOUR;
  const globalLimit = relaxed ? RELAXED_GLOBAL_TEMPLATE_LIMIT_PER_HOUR : GLOBAL_WORKER_TEMPLATE_LIMIT_PER_HOUR;
  const key = `risk:worker-template:${profile}:${accountId}:${userId || "anon"}:${hash}`;
  const count = await connection.incr(key);
  if (count === 1) await connection.expire(key, WORKER_TEMPLATE_WINDOW_SECONDS);
  if (count > perAccountLimit) {
    return `相同/相似提示词提交过于频繁，未提交 Runway（${count}/${perAccountLimit}，${WORKER_TEMPLATE_WINDOW_SECONDS}秒窗口）`;
  }
  const globalKey = `risk:worker-template:global:${profile}:${hash}`;
  const globalCount = await connection.incr(globalKey);
  if (globalCount === 1) await connection.expire(globalKey, WORKER_TEMPLATE_WINDOW_SECONDS);
  if (globalCount > globalLimit) {
    return `全站相同/相似提示词提交过于频繁，未提交 Runway（${globalCount}/${globalLimit}，${WORKER_TEMPLATE_WINDOW_SECONDS}秒窗口）`;
  }
  return null;
}

async function recordRateLimitAndMaybeGlobalCooldown(): Promise<void> {
  const key = "risk:worker-rate-limit:global";
  const count = await connection.incr(key);
  if (count === 1) await connection.expire(key, RATE_LIMIT_WINDOW_SECONDS);
  if (count >= RATE_LIMIT_GLOBAL_THRESHOLD) {
    await connection.set("risk:worker-submit-cooldown", "1", "EX", RATE_LIMIT_GLOBAL_COOLDOWN_SECONDS).catch(() => {});
    console.warn(`[submit-worker] global 429 threshold hit (${count}/${RATE_LIMIT_GLOBAL_THRESHOLD}), cooldown ${RATE_LIMIT_GLOBAL_COOLDOWN_SECONDS}s`);
  }
}

async function checkGlobalSubmitBudget(): Promise<number> {
  const cooldownTtl = await connection.ttl("risk:worker-submit-cooldown").catch(() => -2);
  if (cooldownTtl > 0) return cooldownTtl;

  const key = "risk:worker-submit:global";
  const count = await connection.incr(key);
  if (count === 1) await connection.expire(key, WORKER_TEMPLATE_WINDOW_SECONDS);
  if (count <= WORKER_GLOBAL_SUBMIT_LIMIT_PER_HOUR) return 0;

  const ttl = Math.max(30, await connection.ttl(key).catch(() => 60));
  await connection.set("risk:worker-submit-cooldown", "1", "EX", Math.min(ttl, 300)).catch(() => {});
  return ttl;
}

function pollJobOptions(jobId: string, delay: number) {
  return {
    jobId: `poll-${jobId}-${Date.now()}`,
    delay,
    removeOnComplete: true,
    removeOnFail: JOB_HISTORY_LIMIT,
  };
}

// ═══════════════════════════════════════════════════════════════
// 人工行为模拟参数（所有延迟都在这里配置）
// ═══════════════════════════════════════════════════════════════

/** 提交前延迟：模拟人在页面上操作的时间 */
const PRE_SUBMIT_DELAY_MIN = 20_000;   // 20s
const PRE_SUBMIT_DELAY_MAX = 45_000;   // 45s

/** 提交后到下一次提交的间隔：模拟人看了下结果再操作 */
const POST_SUBMIT_DELAY_MIN = 60_000;  // 60s
const POST_SUBMIT_DELAY_MAX = 120_000; // 120s

/** 批次休息：每提交 N 个任务后，长休息一段时间 */
const BATCH_SIZE_MIN = 30;             // 最少提交30个
const BATCH_SIZE_MAX = 40;             // 最多提交40个再休息
const BATCH_REST_MIN = 30 * 60_000;    // 休息30分钟
const BATCH_REST_MAX = 40 * 60_000;    // 休息40分钟

/** 网络错误重试延迟 */
const NETWORK_RETRY_MIN = 30_000;      // 30s
const NETWORK_RETRY_MAX = 60_000;      // 60s

/** 安全网检查间隔 */
const SAFETY_NET_INTERVAL = 2 * 60_000; // 2分钟

// ═══════════════════════════════════════════════════════════════
// 批次计数器（per-account，Redis 持久化，重启不丢）
// 每个账号独立计数：提交 30~40 个后该账号休息 30~40 分钟
// ═══════════════════════════════════════════════════════════════

/** 随机整数 [min, max) */
function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min));
}

/** 日夜节律倍率：根据上海本地时间 */
function diurnalFactor(): number {
  const now = new Date();
  // 上海时间 = UTC + 8
  const shHour = (now.getUTCHours() + 8) % 24;
  if (shHour >= 2 && shHour < 8) return 3.0;        // 02-08 深夜
  if (shHour < 2 || (shHour >= 8 && shHour < 10)) return 1.8; // 00-02/08-10 过渡
  if ((shHour >= 10 && shHour < 14) || (shHour >= 19 && shHour < 24)) return 1.0; // 高峰
  return 1.2; // 14-19 午后
}

const MAX_DIURNAL_SLEEP = 15 * 60_000;

/** 长尾人类延迟：70% 快速、25% 正常、5% 走神 */
function humanDelay(minMs: number, maxMs: number): number {
  const r = Math.random();
  const span = maxMs - minMs;
  if (r < 0.70) return randInt(minMs, minMs + Math.floor(span * 0.5) + 1);
  if (r < 0.95) return randInt(minMs + Math.floor(span * 0.5), maxMs + 1);
  // 5% 走神
  const zoned = randInt(maxMs, maxMs * 3 + 1);
  return Math.min(zoned, 10 * 60_000);
}

/** 对延迟叠加日夜节律并 clamp */
function withDiurnal(ms: number): number {
  return Math.min(Math.floor(ms * diurnalFactor()), MAX_DIURNAL_SLEEP);
}

/** 获取某账号当前批次的目标数（首次随机生成） */
async function getBatchLimit(accountId: string): Promise<number> {
  const key = `submit:batch-limit:${accountId}`;
  const val = await connection.get(key);
  if (val) return parseInt(val, 10);
  // 不规则批次：15% 小休息批次 / 10% 马拉松 / 75% 正常
  let limit: number;
  const brRand = Math.random();
  if (brRand < 0.15) {
    limit = randInt(8, 16); // 短休息批次
  } else if (brRand < 0.25) {
    limit = randInt(45, 61); // 马拉松
  } else {
    limit = randInt(BATCH_SIZE_MIN, BATCH_SIZE_MAX + 1);
  }
  await connection.set(key, String(limit));
  console.log(`[batch:${accountId.slice(0,8)}] new batch limit: ${limit} tasks`);
  return limit;
}

/** 提交成功后递增该账号计数，返回是否需要休息 */
async function incrementBatchAndCheck(accountId: string, accountLabel: string): Promise<boolean> {
  const countKey = `submit:batch-count:${accountId}`;
  const count = await connection.incr(countKey);
  const limit = await getBatchLimit(accountId);
  console.log(`[batch:${accountLabel}] progress: ${count}/${limit}`);
  return count >= limit;
}

/** 某账号开始批次休息 */
async function startBatchRest(accountId: string, accountLabel: string): Promise<number> {
  // 20% 概率短休息（模拟人去倒水接电话），80% 正常长休息
  const restMs = Math.random() < 0.20
    ? randInt(5 * 60_000, 12 * 60_000 + 1)
    : randInt(BATCH_REST_MIN, BATCH_REST_MAX + 1);
  const restSec = Math.ceil(restMs / 1000);
  const restKey = `submit:batch-resting:${accountId}`;
  const countKey = `submit:batch-count:${accountId}`;
  const limitKey = `submit:batch-limit:${accountId}`;
  await connection.set(restKey, "1", "EX", restSec);
  await connection.del(countKey);
  await connection.del(limitKey);
  console.log(`[batch:${accountLabel}] ★ batch complete! resting for ${(restMs / 60000).toFixed(0)} minutes`);
  return restMs;
}

/** 检查某账号是否正在休息 */
async function isAccountBatchResting(accountId: string): Promise<boolean> {
  const val = await connection.get(`submit:batch-resting:${accountId}`);
  return !!val;
}

/** 检查是否所有账号都在休息 */
async function areAllAccountsResting(): Promise<boolean> {
  const accounts = await accountPool.getAccounts();
  for (const acct of accounts) {
    if (!(await isAccountBatchResting(acct.id))) return false;
  }
  return true;
}

async function recoverStaleLocalSubmits(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_LOCAL_SUBMIT_MINUTES * 60_000);
  const borrowedCutoff = new Date(Date.now() - BORROWED_STALE_SUBMIT_MINUTES * 60_000);
  const jobs = await prisma.runwayJob.findMany({
    where: {
      status: "submitted",
      accountId: { not: null },
      OR: [
        { remoteTaskId: null },
        { remoteTaskId: "" },
      ],
      AND: [{
        OR: [
          { provider: "borrowed", updatedAt: { lt: borrowedCutoff } },
          { provider: { not: "borrowed" }, updatedAt: { lt: cutoff } },
        ],
      }],
    } as any,
    select: { id: true, accountId: true, provider: true },
    orderBy: { updatedAt: "asc" },
    take: 20,
  });

  let recovered = 0;
  for (const job of jobs) {
    const updated = await prisma.runwayJob.updateMany({
      where: {
        id: job.id,
        status: "submitted",
        OR: [{ remoteTaskId: null }, { remoteTaskId: "" }],
      },
      data: {
        status: "pending",
        accountId: null,
        startedAt: null,
        errorMessage: job.provider === "borrowed" ? "借调提交未拿到远程任务号，已回到子控队列重试" : "本地提交未拿到远程任务号，已回到队列重试",
      } as any,
    });
    if (updated.count > 0) {
      if (job.accountId) {
        await accountPool.release(job.accountId, job.id);
        await connection.del(`poll:slot-released:${job.id}`);
      }
      recovered++;
      console.warn(`[submit-worker] recovered stale ${job.provider === "borrowed" ? "borrowed" : "local"} submit ${job.id.slice(0,8)} without remote task`);
    }
  }
  if (recovered > 0) accountPool.invalidateDbCache();
  return recovered;
}

async function normalizeLocalQueuedJobs(): Promise<number> {
  const updated = await prisma.runwayJob.updateMany({
    where: {
      status: "queued",
      accountId: null,
      OR: [{ remoteTaskId: null }, { remoteTaskId: "" }],
    },
    data: {
      status: "pending",
      errorMessage: null,
    } as any,
  });
  if (updated.count > 0) {
    console.warn(`[submit-worker] normalized ${updated.count} local queued job(s) back to pending`);
  }
  return updated.count;
}

// ═══════════════════════════════════════════════════════════════
// 触发器（去重：同一时刻只有一个待执行的触发器）
// ═══════════════════════════════════════════════════════════════

/**
 * 触发一次提交尝试。
 * 去重逻辑：固定 jobId "submit-next"，只保留最早触发的那个。
 * 如果新触发更早，替换旧的。
 */
export async function triggerSubmit(delay = 0): Promise<void> {
  const effectiveDelay = Math.max(delay, 5000);
  try {
    const existing = await submitQueue.getJob("submit-next");
    if (existing) {
      const state = await existing.getState();
      if (state === "delayed" || state === "waiting") {
        const existingFireAt = (existing.timestamp || 0) + (existing.opts?.delay || 0);
        const newFireAt = Date.now() + effectiveDelay;
        if (newFireAt >= existingFireAt) return; // 现有的更早，保留
        await existing.remove().catch(() => {});
      }
    }
    await submitQueue.add("submit-trigger", {}, {
      jobId: "submit-next",
      delay: effectiveDelay,
      removeOnComplete: true,
      removeOnFail: true,
    });
  } catch (e: any) {
    if (!e.message?.includes("already exists")) {
      console.warn("[submit] triggerSubmit error:", e.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 核心提交逻辑
// ═══════════════════════════════════════════════════════════════

type SubmitResult = "submitted" | "no_pending" | "no_account" | "rate_limited" | "batch_resting" | "network_error" | "job_failed";

async function trySubmitOneOnAccount(account: AccountEntry): Promise<SubmitResult> {
  // Account already acquired by the per-account loop caller.
  // Caller is responsible for checking batch-rest / cooldown / global cooldown before calling us.

  // Global cooldown removed — only per-account cooldown applies

  // ── 僵尸任务清理 ──
  await prisma.$executeRawUnsafe(`
    UPDATE runway_jobs SET status = 'failed', error_message = '僵尸任务自动清理'
    WHERE status IN ('pending', 'queued')
      AND finished_at IS NOT NULL
      AND remote_task_id IS NULL
      AND account_id IS NULL
      AND updated_at < NOW() - INTERVAL '5 minutes'
  `).catch(() => {});

  // ── 选取待处理任务（FIFO + 优先级） ──
  // Model-specific prompt guard still applies later, but concurrency occupancy
  // is unified by account maxConcurrency only.
  const pendingJobs = await prisma.$queryRawUnsafe(`
    SELECT id, status, prompt, mode, priority,
           user_id AS "userId",
           image_url AS "imageUrl",
           reference_images AS "referenceImages",
           explore_mode AS "exploreMode",
           model_name AS "modelName",
           result_url AS "resultUrl",
           error_message AS "errorMessage",
           retry_count AS "retryCount",
           created_at AS "createdAt",
           updated_at AS "updatedAt",
           started_at AS "startedAt",
           finished_at AS "finishedAt",
           used_token AS "usedToken",
           account_id AS "accountId",
           remote_task_id AS "remoteTaskId",
           duration, remark, resolution, quality,
           cfg_scale AS "cfgScale",
           sound, progress,
           video_url AS "videoUrl",
           thumbnail_url AS "thumbnailUrl"
    FROM runway_jobs
    WHERE status IN ('pending', 'queued')
    ORDER BY COALESCE(priority, 0) DESC, created_at ASC
    LIMIT ${PENDING_CANDIDATE_LIMIT}
  `) as any[];

  if (pendingJobs.length === 0) {
    await accountPool.releaseNoJob(account.id);
    return "no_pending";
  }

  let dbJob: any = null;
  for (const candidate of pendingJobs) {
    const avoidKey = `job:avoid-account:${candidate.id}:${account.id}`;
    const shouldAvoid = await connection.get(avoidKey);
    if (shouldAvoid) {
      console.log(`[submit-worker] ${account.label} skipping avoided job ${String(candidate.id).slice(0,8)}`);
      continue;
    }
    dbJob = candidate;
    break;
  }

  if (!dbJob) {
    await accountPool.releaseNoJob(account.id);
    return "no_pending";
  }

  const jobId: string = dbJob.id;

  // ── 已有远程任务？恢复轮询 ──
  if (dbJob.remoteTaskId) {
    console.log(`[submit-worker] job ${jobId.slice(0,8)} already has remote ${(dbJob.remoteTaskId as string).slice(0,8)}, resuming poll`);
    const _r1 = await prisma.runwayJob.updateMany({ where: { id: jobId, status: { in: ["pending","queued"] } }, data: { status: "processing" } });
    if (_r1.count === 0) {
      console.log(`[submit-worker] job ${jobId.slice(0,8)} already transitioned by another worker, releasing account (resume-poll CAS miss)`);
      await accountPool.releaseNoJob(account.id);
      return "no_pending";
    }
    await pollQueue.add("poll", {
      jobId, remoteTaskId: dbJob.remoteTaskId,
      accountId: dbJob.accountId || account.id,
    }, pollJobOptions(jobId, 5000));
    return "submitted";
  }

  const guardProfile = getGuardProfile(dbJob.modelName, dbJob.createdAt);
  const contentReviewEnabled = await isContentReviewEnabled();
  if (contentReviewEnabled) {
    const promptRisk = inspectPromptRisk(dbJob.prompt, guardProfile);
    if (promptRisk.blocked) {
      const message = `提示词触发本地风控，未提交 Runway：${localRiskMessage(promptRisk.reason)}${keywordDetail(promptRisk.keywords)}`;
      console.warn(`[submit-worker] ${jobId.slice(0,8)} ${message}`);
      const updated = await prisma.runwayJob.updateMany({
        where: { id: jobId, status: { in: ["pending","queued"] } },
        data: { status: "failed", errorMessage: message, finishedAt: new Date() },
      });
      await accountPool.releaseNoJob(account.id);
      return updated.count === 0 ? "no_pending" : "job_failed";
    }

    const templateBlock = await checkWorkerTemplateBurst(account.id, dbJob.userId, dbJob.prompt, guardProfile);
    if (templateBlock) {
      const message = templateBlock;
      console.warn(`[submit-worker] ${jobId.slice(0,8)} ${message}`);
      const updated = await prisma.runwayJob.updateMany({
        where: { id: jobId, status: { in: ["pending","queued"] } },
        data: { status: "failed", errorMessage: message, finishedAt: new Date() },
      });
      await accountPool.releaseNoJob(account.id);
      return updated.count === 0 ? "no_pending" : "job_failed";
    }
  } else {
    console.warn(`[submit-worker] local content review disabled, submitting ${jobId.slice(0,8)} without local review`);
  }

  console.log(`[submit-worker] picked jobId=${jobId.slice(0,8)} -> account=${account.label}`);

  // 锁定任务，防止重复选取 (CAS: 只从 pending/queued 推到 submitted)
  const _lock = await prisma.runwayJob.updateMany({
    where: { id: jobId, status: { in: ["pending","queued"] } },
    data: { status: "submitted" },
  });
  if (_lock.count === 0) {
    console.log(`[submit-worker] job ${jobId.slice(0,8)} already transitioned by another worker, releasing account (lock CAS miss)`);
    await accountPool.releaseNoJob(account.id);
    return "no_pending";
  }

  // 解析参考图片
  let imageUrls: string[] | undefined;
  if (dbJob.referenceImages) {
    try { imageUrls = JSON.parse(dbJob.referenceImages); } catch (e: any) { console.warn("[submit] referenceImages parse error:", e.message); }
  }

  // ── 账号回避检查（之前在该账号失败过的任务） ──
  // Per-account loops: if this account is flagged to avoid this job, skip it
  // and let another account's loop pick it up later.
  const avoidKey = `job:avoid-account:${jobId}:${account.id}`;
  const shouldAvoid = await connection.get(avoidKey);
  if (shouldAvoid) {
    console.log(`[submit-worker] ${account.label} avoiding job ${jobId.slice(0,8)}, releasing for another account`);
    await prisma.runwayJob.update({ where: { id: jobId }, data: { status: "pending" } });
    await accountPool.releaseNoJob(account.id);
    return "no_pending";
  }

  // 清理旧的释放标记
  await connection.del(`account:released:${account.id}:${jobId}`);

  const client = new RunwayDirectClient(account.token, Number(account.teamId), account.proxyUrl || undefined);

  try {
    await prisma.runwayJob.update({
      where: { id: jobId },
      data: { startedAt: new Date(), usedToken: account.tokenShort, accountId: account.id } as any,
    });

    // ── 人工延迟：模拟操作时间 ──
    let preSubmitDelay = humanDelay(PRE_SUBMIT_DELAY_MIN, PRE_SUBMIT_DELAY_MAX);
    // 提示词打字时长：每字符 40-130ms，上限 +20s
    const promptLen = (dbJob.prompt ? String(dbJob.prompt).length : 0);
    const typingBonus = Math.min(promptLen * randInt(40, 131), 20_000);
    preSubmitDelay = Math.min(preSubmitDelay + typingBonus, PRE_SUBMIT_DELAY_MAX + 20_000);
    {
      const _sp = await getSpeedMultiplier();
      const _eff = Math.round(preSubmitDelay / _sp);
      console.log(`[submit-worker] pre-submit delay ${(_eff/1000).toFixed(0)}s for ${jobId.slice(0,8)} on ${account.label}${_sp !== 1.0 ? ` (speed=${_sp}x)` : ''}`);
      await sleep(_eff);
    }

    // ══════════════════════════════════════════════════════════
    // API 调用前三重检查（延迟期间情况可能已变）
    // ══════════════════════════════════════════════════════════

    // Ensure this delayed submit still owns the job before calling the upstream API.
    const ownedJob = await prisma.runwayJob.findUnique({
      where: { id: jobId },
      select: { status: true, accountId: true },
    });
    if (!ownedJob || ownedJob.status !== "submitted" || ownedJob.accountId !== account.id) {
      console.warn(
        `[submit-worker] job ${jobId.slice(0,8)} ownership changed before submit ` +
        `(status=${ownedJob?.status || "missing"}, account=${ownedJob?.accountId || "none"}), aborting ${account.label}`
      );
      await accountPool.releaseNoJob(account.id);
      return "no_pending";
    }

    // 检查1: 账号冷却
    const acctCooldown = await connection.get(`account:cooldown:${account.id}`);
    if (acctCooldown) {
      console.log(`[submit-worker] account ${account.label} entered cooldown during delay, aborting ${jobId.slice(0,8)}`);
      await accountPool.release(account.id);
      await prisma.runwayJob.updateMany({ where: { id: jobId, status: "submitted" }, data: { status: "pending", accountId: null, startedAt: null } as any });
      return "rate_limited";
    }

    // 检查3: 账号实际并发数（DB 权威数据）
    const acctActiveCount = await prisma.runwayJob.count({
      where: {
        accountId: account.id,
        status: { in: ["submitted", "processing"] },
        id: { not: jobId },
      },
    });
    if (acctActiveCount >= account.maxConcurrency) {
      console.log(`[submit-worker] account ${account.label} already has ${acctActiveCount}/${account.maxConcurrency} active tasks (DB), aborting ${jobId.slice(0,8)}`);
      await accountPool.release(account.id);
      await prisma.runwayJob.updateMany({ where: { id: jobId, status: "submitted" }, data: { status: "pending", accountId: null, startedAt: null } as any });
      return "no_account";
    }

    // 检查4: Platform 平台实际并发数（远程 API 权威数据）
    try {
      const realActive = await client.getActiveConcurrency();
      if (realActive >= account.maxConcurrency) {
        console.log(`[submit-worker] Platform reports ${realActive} active for ${account.label} (max ${account.maxConcurrency}), aborting ${jobId.slice(0,8)}`);
        await accountPool.release(account.id);
        await accountPool.setCooldown(account.id, 90);
        await prisma.runwayJob.updateMany({ where: { id: jobId, status: "submitted" }, data: { status: "pending", accountId: null, startedAt: null } as any });
        return "no_account";
      }
      console.log(`[submit-worker] Platform real concurrency: ${realActive}/${account.maxConcurrency} for ${account.label}`);
    } catch (e: any) {
      // API 查询失败不阻塞提交，退回本地检查
      console.warn(`[submit-worker] getActiveConcurrency failed for ${account.label}: ${e.message}, proceeding with local check`);
    }

    // ══════════════════════════════════════════════════════════
    // 调用 Platform API
    // ══════════════════════════════════════════════════════════

    const submitBudgetWait = await checkGlobalSubmitBudget();
    if (submitBudgetWait > 0) {
      console.warn(`[submit-worker] global submit budget exhausted, delaying ${jobId.slice(0,8)} for ${submitBudgetWait}s`);
      await accountPool.release(account.id);
      await prisma.runwayJob.updateMany({
        where: { id: jobId, status: "submitted" },
        data: { status: "pending", accountId: null, startedAt: null, errorMessage: `Runway 提交过于频繁，延后提交（${submitBudgetWait}秒后重试）` } as any,
      });
      return "batch_resting";
    }

    const { remoteTaskId } = await client.createTask({
      prompt:      dbJob.prompt,
      mode:        dbJob.mode as any,
      imageUrl:    dbJob.imageUrl || undefined,
      imageUrls,
      duration:    dbJob.duration || 5,
      exploreMode: dbJob.exploreMode ?? false,
      modelName:   dbJob.modelName || "kling_3_0_pro",
      resolution:  dbJob.resolution,
      quality:     dbJob.quality,
      cfgScale:    dbJob.cfgScale,
      sound:       dbJob.sound,
      videoUrl:    dbJob.videoUrl,
    });

    const _proc = await prisma.runwayJob.updateMany({
      where: { id: jobId, status: "submitted", accountId: account.id },
      data: { remoteTaskId, status: "processing" },
    });
    if (_proc.count === 0) {
      console.warn(`[submit-worker] jobId=${jobId.slice(0,8)} status changed during submit, remote ${remoteTaskId.slice(0,8)} orphaned on platform`);
    }
    console.log(`[submit-worker] ✓ jobId=${jobId.slice(0,8)} -> processing, remote=${remoteTaskId.slice(0,8)}, account=${account.label}`);

    // 加入轮询队列（带重试）
    let pollAdded = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await pollQueue.add("poll", {
          jobId, remoteTaskId, accountId: account.id,
        }, pollJobOptions(jobId, 15000));
        pollAdded = true;
        break;
      } catch (pollErr: any) {
        console.error(`[submit-worker] pollQueue.add attempt ${attempt}/3 failed: ${pollErr.message}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 1000));
      }
    }
    if (!pollAdded) {
      console.error(`[submit-worker] pollQueue.add failed 3x, leaving ${jobId.slice(0,8)} in processing for recovery`);
    }

    return "submitted";

  } catch (err: any) {
    const msg = err.message || String(err);
    console.error(`[submit-worker] jobId=${jobId.slice(0,8)} error: ${msg.slice(0, 120)}`);

    const isNetworkError = /socket hang up|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|EAI_AGAIN|network|fetch failed|abort|aborted/i.test(msg);

    if (msg === "RATE_LIMITED") {
      await accountPool.release(account.id);
      await accountPool.recordError(account.id, "429 Rate Limited");
      await accountPool.setCooldown(account.id, 420);
      await recordRateLimitAndMaybeGlobalCooldown();
      await prisma.runwayJob.updateMany({ where: { id: jobId, status: "submitted" }, data: { status: "pending", accountId: null, startedAt: null } as any });
      return "rate_limited";
    }

    if (isNetworkError) {
      await accountPool.release(account.id);
      await accountPool.recordError(account.id, msg.slice(0, 200));
      await prisma.runwayJob.update({ where: { id: jobId }, data: { status: "pending", accountId: null, errorMessage: '网络错误(将重试)' } as any });
      return "network_error";
    }

    // 永久失败
    await accountPool.release(account.id, jobId);
    await accountPool.handleRiskError(account.id, msg);
    await prisma.runwayJob.update({
      where: { id: jobId },
      data: { status: "failed", errorMessage: translateRunwayError(msg).slice(0, 500), finishedAt: new Date() },
    });
    return "job_failed";
  }
}

// ═══════════════════════════════════════════════════════════════
// Worker 主处理器
// ═══════════════════════════════════════════════════════════════

new Worker("runway-submit", async (_job: Job) => {
  // Per-account loops are the primary submitter now.
  // This trigger is kept as a no-op so legacy callers (API) don't error.
  // The safety-net interval below also still runs as a backup.
  return;
}, {
  connection,
  concurrency: 1,
});

// ═══════════════════════════════════════════════════════════════
// Per-account submit loops (parallel submission engine)
// Each active account runs its own independent loop with its own
// pre/post delays, batch counter, cooldown handling.
// ═══════════════════════════════════════════════════════════════

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** 全局速度倍率：从 Redis 读取，clamp 到 [0.1, 2.0]，默认 1.0
 *  speed=2.0 → 更快 → 除以；speed=0.1 → 极慢 → 除以（结果变大）
 *  effective sleep = baseMs / speed
 */
async function getSpeedMultiplier(): Promise<number> {
  try {
    const v = await connection.get("runway:speed-multiplier");
    if (!v) return 1.0;
    const f = parseFloat(v);
    if (!isFinite(f) || isNaN(f)) return 1.0;
    return Math.max(0.1, Math.min(2.0, f));
  } catch {
    return 1.0;
  }
}

/** 按全局速度倍率缩放后的人类延迟睡眠 */
async function humanSleep(ms: number): Promise<void> {
  const sp = await getSpeedMultiplier();
  await sleep(Math.round(ms / sp));
}

async function getQueuedJobCount(accountId: string): Promise<number> {
  return prisma.runwayJob.count({
    where: {
      accountId,
      status: { in: ["queued", "submitted", "processing"] },
      errorMessage: { startsWith: "平台排队中" },
    },
  });
}

async function getActiveJobCount(accountId: string): Promise<number> {
  return prisma.runwayJob.count({
    where: {
      accountId,
      status: { in: ["submitted", "processing"] },
    },
  });
}

async function shouldHoldSecondSlotForQueuedJob(): Promise<boolean> {
  const raw = await connection.get("runway:hold-second-slot-on-queued").catch(() => null);
  if (raw !== null) return raw === "1";
  return process.env.RUNWAY_HOLD_SECOND_SLOT_ON_QUEUED !== "0";
}

async function getMaxSlotsWhenQueued(maxConcurrency: number): Promise<number> {
  const raw = await connection.get("runway:max-slots-when-queued").catch(() => null);
  const configured = raw !== null ? Number(raw) : Number(process.env.RUNWAY_MAX_SLOTS_WHEN_QUEUED || 2);
  if (!Number.isFinite(configured)) return Math.min(2, maxConcurrency);
  return Math.max(1, Math.min(maxConcurrency, Math.floor(configured)));
}

async function shouldHoldForQueuedJob(account: AccountEntry): Promise<boolean> {
  if (!(await shouldHoldSecondSlotForQueuedJob())) return false;
  const queued = await getQueuedJobCount(account.id);
  if (queued <= 0) return false;
  const active = await getActiveJobCount(account.id);
  const cap = await getMaxSlotsWhenQueued(account.maxConcurrency);
  const hold = active >= cap;
  if (hold) {
    console.log(`[loop:${account.id.slice(0,8)}] queued hold active=${active}/${account.maxConcurrency}, queued=${queued}, cap=${cap}`);
  }
  return hold;
}

type AccountLoopState = { stopFlag: boolean; started?: boolean };
const accountLoops = new Map<string, AccountLoopState>();

async function accountSubmitLoop(accountId: string, existingState?: AccountLoopState): Promise<void> {
  const state = existingState || accountLoops.get(accountId) || { stopFlag: false };
  if (state.started) return;
  state.started = true;
  accountLoops.set(accountId, state);
  console.log(`[loop:${accountId.slice(0,8)}] started`);

  while (!state.stopFlag) {
    try {
      // Refetch account config each iteration so priority/maxConcurrency/active changes apply
      const accounts = await accountPool.getAccounts();
      const account = accounts.find(a => a.id === accountId);
      if (!account) {
        console.log(`[loop:${accountId.slice(0,8)}] account no longer active, exiting`);
        break;
      }

      // Token expired?
      if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now()) {
        await sleep(60_000);
        continue;
      }

      // 深夜概率性跳过（diurnal >= 2.5 时 80% 概率休长觉）
      {
        const df = diurnalFactor();
        // Runtime toggle: redis key runway:deep-night-enabled ("1"=on, "0"=off). Default on.
        const dnRaw = await connection.get("runway:deep-night-enabled").catch(() => null);
        const deepNightOn = dnRaw === null ? (process.env.DISABLE_DEEP_NIGHT_SKIP !== "1") : (dnRaw === "1");
        if (deepNightOn && df >= 2.5 && Math.random() < 0.80) {
          const skipMs = Math.min(randInt(120_000, 300_001) * df, MAX_DIURNAL_SLEEP);
          console.log(`[loop:${accountId.slice(0,8)}] deep-night skip, sleeping ${(skipMs/60000).toFixed(1)}min`);
          await humanSleep(skipMs);
          continue;
        }
      }

      // Account-level batch rest?
      if (await isAccountBatchResting(account.id)) {
        const ttl = await connection.ttl(`submit:batch-resting:${account.id}`);
        await sleep(Math.min(Math.max(ttl, 5), 60) * 1000);
        continue;
      }

      // Account in cooldown (e.g. 429)?
      const cooldown = await connection.get(`account:cooldown:${account.id}`);
      if (cooldown) {
        const ttl = await connection.ttl(`account:cooldown:${account.id}`);
        await sleep(Math.min(Math.max(ttl, 5), 60) * 1000);
        continue;
      }

      // Global submit budget cooldown limits automated bursts across all accounts.
      const submitCooldown = await connection.get("risk:worker-submit-cooldown");
      if (submitCooldown) {
        const ttl = await connection.ttl("risk:worker-submit-cooldown");
        await sleep(Math.min(Math.max(ttl, 5), 60) * 1000);
        continue;
      }

      await recoverStaleLocalSubmits();

      // Optional conservative mode: hold an account's second local slot when it
      // already has a platform-queued task. Default is off so account
      // maxConcurrency=2 can actually run as 2 local slots.
      if (await shouldHoldForQueuedJob(account)) {
        await humanSleep(humanDelay(18_000, 36_000));
        continue;
      }

      // Try to acquire a slot ON THIS ACCOUNT
      const acquired = await accountPool.acquireSpecific(account.id);
      if (!acquired) {
        // Slot full — wait for a poll release
        await humanSleep(humanDelay(6_000, 14_000));
        continue;
      }

      // Submit on this account (internally does pre-delay + API call + post-checks).
      // Watchdog: even with per-fetch timeouts, belt-and-suspenders ensures the loop
      // never gets stuck. trySubmitOneOnAccount includes a 20-65s pre-submit delay
      // plus several Runway API calls; 6 min covers the worst realistic case.
      const WATCHDOG_MS = 6 * 60_000;
      let watchdogTimer: any;
      const watchdog = new Promise<SubmitResult>(resolve => {
        watchdogTimer = setTimeout(() => {
          console.error(`[loop:${account.label}] watchdog fired — trySubmitOneOnAccount exceeded ${WATCHDOG_MS/1000}s, forcing release`);
          accountPool.release(account.id).catch(() => {});
          resolve("network_error");
        }, WATCHDOG_MS);
      });
      let result: SubmitResult;
      try {
        result = await Promise.race([trySubmitOneOnAccount(acquired), watchdog]);
      } finally {
        clearTimeout(watchdogTimer);
      }

      switch (result) {
        case "submitted": {
          const needRest = await incrementBatchAndCheck(account.id, account.label);
          if (needRest) await startBatchRest(account.id, account.label);
          const d = withDiurnal(humanDelay(POST_SUBMIT_DELAY_MIN, POST_SUBMIT_DELAY_MAX));
          const _sp = await getSpeedMultiplier();
          const _eff = Math.round(d / _sp);
          console.log(`[loop:${account.label}] submitted OK, sleeping ${(_eff/1000).toFixed(0)}s${_sp !== 1.0 ? ` (speed=${_sp}x)` : ''}`);
          await sleep(_eff);
          break;
        }
        case "no_pending":
          await humanSleep(humanDelay(8_000, 16_000));
          break;
        case "no_account":
          await humanSleep(humanDelay(6_000, 12_000));
          break;
        case "rate_limited":
          // 保留 5s 冷却，但加 ±2s 抖动 (不缩放 — 这是速率限制冷却)
          await sleep(5_000 + randInt(-2_000, 2_001));
          break;
        case "network_error":
          await humanSleep(humanDelay(NETWORK_RETRY_MIN, NETWORK_RETRY_MAX) * randInt(1, 4));
          break;
        case "job_failed":
          await humanSleep(humanDelay(15_000, 45_000));
          break;
        case "batch_resting":
          await humanSleep(humanDelay(25_000, 45_000));
          break;
      }
    } catch (e: any) {
      console.error(`[loop:${accountId.slice(0,8)}] uncaught error: ${e.message}`);
      await sleep(10_000);
    }
  }
  accountLoops.delete(accountId);
  console.log(`[loop:${accountId.slice(0,8)}] stopped`);
}

async function refreshAccountLoops(): Promise<void> {
  try {
    accountPool.invalidateCache();
    const accounts = await accountPool.getAccounts();
    const activeIds = new Set(accounts.map(a => a.id));
    for (const a of accounts) {
      if (!accountLoops.has(a.id)) {
        // 随机错开启动，避免 3 个账号齐步走
        const offset = randInt(0, 45_001);
        const state: AccountLoopState = { stopFlag: false };
        accountLoops.set(a.id, state);
        setTimeout(() => {
          accountSubmitLoop(a.id, state).catch(e => console.error(`[loop:spawn] ${e.message}`));
        }, offset);
      }
    }
    for (const id of accountLoops.keys()) {
      if (!activeIds.has(id)) {
        const s = accountLoops.get(id);
        if (s) s.stopFlag = true;
      }
    }
  } catch (e: any) {
    console.warn(`[loop-refresh] ${e.message}`);
  }
}

/** Put a 24h TTL on batch-count/limit keys that have no expiry.
 *  They are normally cleared by startBatchRest(), but a hung loop can leave
 *  them permanently. A TTL bound ensures they self-heal after a day. */
async function reconcileOrphanBatchKeys(): Promise<void> {
  try {
    const patterns = ["submit:batch-count:*", "submit:batch-limit:*"];
    for (const pat of patterns) {
      const keys = await connection.keys(pat);
      for (const k of keys) {
        const ttl = await connection.ttl(k);
        if (ttl === -1) {
          await connection.expire(k, 24 * 3600);
          console.log(`[startup] bounded TTL (24h) on orphan key ${k}`);
        }
      }
    }
  } catch (e: any) {
    console.warn("[startup] reconcileOrphanBatchKeys error:", e.message);
  }
}

(async () => {
  await reconcileOrphanBatchKeys();
  await recoverStaleLocalSubmits();
  await normalizeLocalQueuedJobs();
  await refreshAccountLoops();
  setInterval(refreshAccountLoops, 30_000);
})();

// ═══════════════════════════════════════════════════════════════
// Safety Net（兜底检查，每2分钟）
// 条件：有待处理任务 + 不在冷却/休息中 + 有空闲账号 + 无排队触发器
// ═══════════════════════════════════════════════════════════════

setInterval(async () => {
  try {
    await recoverStaleLocalSubmits();
    await normalizeLocalQueuedJobs();
    const pendingCount = await prisma.runwayJob.count({ where: { status: { in: ["pending", "queued"] } } });
    if (pendingCount === 0) return;

    // 所有账号都在批次休息中不触发
    if (await areAllAccountsResting()) return;

    // 检查是否有账号在 DB 层有空位（排除休息中的账号）
    const accounts = await accountPool.getAccounts();
    let hasSlot = false;
    for (const acct of accounts) {
      if (await isAccountBatchResting(acct.id)) continue;
      const dbActive = await prisma.runwayJob.count({
        where: {
          accountId: acct.id,
          status: { in: ["submitted", "processing"] },
        },
      });
      if (dbActive < acct.maxConcurrency) {
        hasSlot = true;
        break;
      }
    }
    if (!hasSlot) return;

    // 已有触发器排队就不重复
    const existing = await submitQueue.getJob("submit-next");
    if (existing) {
      const state = await existing.getState();
      if (state === "delayed" || state === "waiting" || state === "active") return;
    }
    // Also check if there's an active worker processing right now
    const activeCount = await submitQueue.getActiveCount();
    if (activeCount > 0) return;

    console.log(`[safety-net] ${pendingCount} pending, slot available — refreshing account loops`);
    await refreshAccountLoops();
  } catch (e: any) {
    console.warn("[safety-net] error:", e.message);
  }
}, SAFETY_NET_INTERVAL);

console.log("[submit-worker] listening (per-account concurrency + batch rest + 2min safety net)");
