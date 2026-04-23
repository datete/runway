import fetch from "node-fetch";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { RunwayProvider, CreateRunwayTaskInput, RunwayTaskStatus } from "./runway.provider";

const API_BASE = "https://api.runwayml.com";

// Default per-request timeouts. node-fetch has no default, so without these a proxy
// outage hangs the awaiting loop forever.
const TIMEOUT_SRC_DOWNLOAD = 60_000;    // downloading user-supplied images/videos
const TIMEOUT_UPLOAD_INIT  = 20_000;    // /v1/uploads init + complete
const TIMEOUT_S3_PUT       = 120_000;   // raw S3 PUT (large files)
const TIMEOUT_CREATE_TASK  = 30_000;    // POST /v1/tasks
const TIMEOUT_GET_TASK     = 20_000;    // GET /v1/tasks/:id + /v1/tasks list
const TIMEOUT_ARTIFACT     = 60_000;    // fetch result artifact
const TIMEOUT_CANCEL       = 15_000;

async function timedFetch(url: string, opts: any, timeoutMs: number, label: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal as any });
  } catch (e: any) {
    if (e?.name === "AbortError" || /aborted/i.test(e?.message ?? "")) {
      throw new Error(`${label} timeout after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export class RunwayDirectClient implements RunwayProvider {
  private token: string;
  private teamId: number;
  private proxyUrl?: string;
  private cachedAgent: any = null;

  constructor(token?: string, teamId?: number, proxyUrl?: string) {
    this.token  = token || process.env.RUNWAY_TOKEN || "";
    this.teamId = teamId || Number(process.env.RUNWAY_TEAM_ID) || 0;
    this.proxyUrl = proxyUrl;
    if (!this.token) throw new Error("RUNWAY_TOKEN is not set");
    if (!this.teamId) throw new Error("RUNWAY_TEAM_ID is not set");
    console.log(`[runway] client init, teamId=${this.teamId}${this.proxyUrl ? ', proxy=' + this.proxyUrl.split('@').pop() : ''}`);
  }

  // Chrome UA pool — rotate per-client instance to spread fingerprint
  private static readonly UA_POOL = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  ];
  private readonly userAgent = RunwayDirectClient.UA_POOL[Math.floor(Math.random() * RunwayDirectClient.UA_POOL.length)];

  private get headers() {
    return {
      "Authorization":              `Bearer ${this.token}`,
      "Content-Type":               "application/json",
      "Accept":                     "application/json",
      "Accept-Language":            "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
      "Accept-Encoding":            "gzip, deflate, br",
      "Origin":                     "https://app.runwayml.com",
      "Referer":                    "https://app.runwayml.com/",
      "User-Agent":                 this.userAgent,
      "X-Runway-Workspace":         String(this.teamId),
      "X-Runway-Source-Application":"web",
      "Sec-Ch-Ua":                  `"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"`,
      "Sec-Ch-Ua-Mobile":           "?0",
      "Sec-Ch-Ua-Platform":         `"Windows"`,
      "Sec-Fetch-Dest":             "empty",
      "Sec-Fetch-Mode":             "cors",
      "Sec-Fetch-Site":             "same-site",
      "Connection":                 "keep-alive",
    };
  }

  /** Get fetch options with proxy agent if configured (cached) */
  private async getFetchOptions(): Promise<{ agent?: any }> {
    if (!this.proxyUrl) return {};
    if (this.cachedAgent) return { agent: this.cachedAgent };
    try {
      let agent: any;
      if (this.proxyUrl.startsWith('socks')) {
        const { SocksProxyAgent } = await import('socks-proxy-agent');
        agent = new SocksProxyAgent(this.proxyUrl);
      } else {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        agent = new HttpsProxyAgent(this.proxyUrl);
      }
      this.cachedAgent = agent;
      return { agent };
    } catch (e: any) {
      console.warn(`[runway] proxy agent init failed: ${e.message}, using direct connection`);
      return {};
    }
  }

  /**
   * Upscale/resize image to target resolution for maximum quality.
   * Resizes to fit within target dimensions, then extends with black background.
   */
  private async upscaleImage(buf: Buffer, targetWidth: number, targetHeight: number): Promise<Buffer> {
    try {
      const meta = await sharp(buf).metadata();
      if (!meta.width || !meta.height) return buf;
      // Skip if already at or above target size
      if (meta.width >= targetWidth && meta.height >= targetHeight) {
        console.log(`[runway:upscale] image ${meta.width}x${meta.height} already >= ${targetWidth}x${targetHeight}, skip`);
        return buf;
      }
      const result = await sharp(buf)
        .resize(targetWidth, targetHeight, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
        .png()
        .toBuffer();
      console.log(`[runway:upscale] ${meta.width}x${meta.height} -> ${targetWidth}x${targetHeight} (${Math.round(result.length/1024)}KB)`);
      return result;
    } catch (e: any) {
      console.warn(`[runway:upscale] failed: ${e.message}, using original`);
      return buf;
    }
  }

  /** Download an image from any URL, upload to Runway S3, return signed CloudFront URL */
  async uploadImage(sourceUrl: string, isPro = false): Promise<string> {
    // Convert relative /img/ paths to absolute localhost URL
    if (sourceUrl.startsWith("/")) sourceUrl = `http://localhost:5102${sourceUrl}`;
    console.log(`[runway:upload] source: ${sourceUrl}`);

    // Step 1 – download source image (no proxy needed for local/external image download)
    const imgRes = await timedFetch(sourceUrl, {}, TIMEOUT_SRC_DOWNLOAD, "source download");
    if (!imgRes.ok) throw new Error(`Failed to download image ${imgRes.status}: ${sourceUrl}`);
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    const ct = imgRes.headers.get("content-type") || "image/png";
    const ext = ct.includes("jpeg") || ct.includes("jpg") ? "jpg"
              : ct.includes("webp") ? "webp"
              : ct.includes("gif")  ? "gif"
              : ct.includes("mp4")  ? "mp4"
              : ct.includes("video") ? "mp4"
              : "png";
    console.log(`[runway:upload] downloaded ${imgBuf.length} bytes, type=${ct}`);

    // Auto-upscale reference image to max resolution for best quality
    const isImage = !ct.includes("video") && !ct.includes("mp4") && !ct.includes("gif");
    let finalBuf = imgBuf;
    let finalCt = ct;
    if (isImage) {
      const [tw, th] = [1076, 1920];
      finalBuf = await this.upscaleImage(imgBuf, tw, th) as any;
      finalCt = "image/png";
    }
    const filename = `ref_${Date.now()}.${isImage ? "png" : ext}`;

    const proxyOpts = await this.getFetchOptions();

    // Step 2 – initiate upload
    const initRes = await timedFetch(`${API_BASE}/v1/uploads`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ filename, numberOfParts: 1, type: "DATASET", asTeamId: this.teamId }),
      ...proxyOpts,
    }, TIMEOUT_UPLOAD_INIT, "upload init");
    if (!initRes.ok) throw new Error(`Upload init ${initRes.status}: ${await initRes.text()}`);
    const init = await initRes.json() as any;
    const uploadId: string = init.id;
    const s3Url: string    = init.uploadUrls[0];
    console.log(`[runway:upload] initiated uploadId=${uploadId}`);

    // Step 3 – PUT to S3 presigned URL (with retry)
    let putRes: any = null;
    let etag = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        putRes = await timedFetch(s3Url, {
          method: "PUT",
          headers: { "Content-Type": finalCt },
          body: finalBuf,
        }, TIMEOUT_S3_PUT, "S3 PUT");
        if (putRes.ok) {
          etag = (putRes.headers.get("ETag") || "").replace(/"/g, "");
          console.log(`[runway:upload] S3 PUT ok (attempt ${attempt}), ETag=${etag}`);
          break;
        }
        console.warn(`[runway:upload] S3 PUT ${putRes.status} (attempt ${attempt}/3)`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
      } catch (e: any) {
        console.warn(`[runway:upload] S3 PUT error (attempt ${attempt}/3): ${e.message}`);
        if (attempt === 3) throw e;
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
    if (!putRes || !putRes.ok) throw new Error(`S3 PUT failed after 3 attempts`);

    // Step 4 – complete upload
    const completeRes = await timedFetch(`${API_BASE}/v1/uploads/${uploadId}/complete`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ parts: [{ PartNumber: 1, ETag: etag }], asTeamId: this.teamId }),
      ...proxyOpts,
    }, TIMEOUT_UPLOAD_INIT, "upload complete");
    if (!completeRes.ok) throw new Error(`Upload complete ${completeRes.status}: ${await completeRes.text()}`);
    const complete = await completeRes.json() as any;
    const runwayUrl: string = complete.url;
    console.log(`[runway:upload] complete, runwayUrl=${runwayUrl.split("?")[0]}`);
    return runwayUrl;
  }

  /** Upload any file (image or video) to Runway S3, return url and assetId */
  async uploadFileWithAsset(sourceUrl: string): Promise<{ url: string; assetId: string }> {
    // Convert relative /img/ paths to absolute localhost URL
    if (sourceUrl.startsWith("/")) sourceUrl = `http://localhost:5102${sourceUrl}`;
    console.log(`[runway:upload:video] source: ${sourceUrl}`);

    const imgRes = await timedFetch(sourceUrl, {}, TIMEOUT_SRC_DOWNLOAD, "source video download");
    if (!imgRes.ok) throw new Error(`Failed to download file ${imgRes.status}: ${sourceUrl}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const ct = imgRes.headers.get("content-type") || "video/mp4";
    const ext = ct.includes("mp4") || ct.includes("video") ? "mp4" : "png";
    const filename = `ref_${Date.now()}.${ext}`;
    console.log(`[runway:upload:video] downloaded ${buf.length} bytes, type=${ct}`);

    const proxyOpts = await this.getFetchOptions();

    const initRes = await timedFetch(`${API_BASE}/v1/uploads`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ filename, numberOfParts: 1, type: "DATASET", asTeamId: this.teamId }),
      ...proxyOpts,
    }, TIMEOUT_UPLOAD_INIT, "video upload init");
    if (!initRes.ok) throw new Error(`Upload init ${initRes.status}: ${await initRes.text()}`);
    const init = await initRes.json() as any;
    const uploadId: string = init.id;
    const s3Url: string = init.uploadUrls[0];

    const putRes = await timedFetch(s3Url, {
      method: "PUT",
      headers: { "Content-Type": ct },
      body: buf,
    }, TIMEOUT_S3_PUT, "video S3 PUT");
    if (!putRes.ok) throw new Error(`S3 PUT ${putRes.status}`);
    const etag = (putRes.headers.get("ETag") || "").replace(/"/g, "");

    const completeRes = await timedFetch(`${API_BASE}/v1/uploads/${uploadId}/complete`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ parts: [{ PartNumber: 1, ETag: etag }], asTeamId: this.teamId }),
      ...proxyOpts,
    }, TIMEOUT_UPLOAD_INIT, "video upload complete");
    if (!completeRes.ok) throw new Error(`Upload complete ${completeRes.status}: ${await completeRes.text()}`);
    const complete = await completeRes.json() as any;
    console.log(`[runway:upload:video] complete, assetId=${uploadId}, url=${(complete.url || "").split("?")[0]}`);
    return { url: complete.url, assetId: uploadId };
  }

  /** Upload any file (image or video) to Runway S3 */
  async uploadFile(sourceUrl: string, isPro = false): Promise<string> {
    return this.uploadImage(sourceUrl, isPro);
  }

  /** Upload multiple images and return referenceImages array for task creation */
  private async uploadReferenceImages(urls: string[], isPro = false): Promise<Array<{ url: string }>> {
    console.log(`[runway] uploading ${urls.length} reference image(s)`);
    const results: Array<{ url: string }> = [];
    for (let i = 0; i < urls.length; i++) {
      console.log(`[runway] image ${i + 1}/${urls.length}: ${urls[i]}`);
      const runwayUrl = await this.uploadImage(urls[i], isPro);
      results.push({ url: runwayUrl });
      console.log(`[runway] image ${i + 1} uploaded ok`);
    }
    return results;
  }

  async createTask(input: CreateRunwayTaskInput): Promise<{ remoteTaskId: string }> {
    const isSeedance = input.modelName === "seedance_2";
    const isStandard = !isSeedance && input.quality === "standard";
    const taskType = isSeedance ? "seedance_2" : (isStandard ? "kling_3_0_standard" : "kling_3_0_pro");
    const isPro = !isStandard && !isSeedance;
    console.log(`[runway:task] creating ${taskType} (model=${input.modelName}, quality=${input.quality || "std"})`);
    console.log(`[runway:task] prompt: "${input.prompt.slice(0, 80)}"`);
    console.log(`[runway:task] duration=${input.duration || 5}s, exploreMode=${input.exploreMode ?? false}`);

    // Collect all source image URLs
    const sourceUrls: string[] = [
      ...(input.imageUrls || []),
      ...(input.imageUrl && !input.imageUrls ? [input.imageUrl] : []),
    ].filter(Boolean);

    console.log(`[runway:task] reference images to upload: ${sourceUrls.length}`);
    if (sourceUrls.length > 2) {
      console.warn(`[runway:task] user sent ${sourceUrls.length} ref images, truncating to 2 (API limit)`);
      sourceUrls.splice(2);
    }

    // Upload images to Runway
    let referenceImages: Array<{ url: string }> = [];
    if (sourceUrls.length > 0) {
      referenceImages = await this.uploadReferenceImages(sourceUrls, isPro);
    }

    // Upload reference video for pro mode
    // NOTE: upstream Kling 拒绝 referenceVideos 当参考图 > 1 张时("Reference videos are not supported for this model")
    // 因此多参考图场景下跳过 ref video,只送参考图。
    let referenceVideoAsset: { url: string; assetId: string } | undefined;
    if (input.videoUrl && referenceImages.length <= 1) {
      console.log(`[runway:task] uploading reference video: ${input.videoUrl}`);
      referenceVideoAsset = await this.uploadFileWithAsset(input.videoUrl);
      console.log(`[runway:task] reference video uploaded, assetId=${referenceVideoAsset.assetId}`);
    } else if (input.videoUrl && referenceImages.length > 1) {
      console.log(`[runway:task] skipping ref video (refs=${referenceImages.length} > 1, upstream rejects)`);
    }

    // Use resolution from frontend directly; fallback to defaults if missing
    let effectiveResolution: string;
    if (isSeedance) {
      // Seedance uses "720p" / "480p" string format
      effectiveResolution = input.resolution || "720p";
    } else {
      const defaultRes = isStandard ? "720x1280" : "1080x1920";
      const proResolutionMap: Record<string, string> = { "1076x1920": "1080x1920", "720x1280": "1080x1920", "1280x720": "1920x1080", "960x960": "1440x1440" };
      effectiveResolution = input.resolution
        ? (isStandard ? input.resolution : (proResolutionMap[input.resolution] || input.resolution))
        : defaultRes;
    }

    let body: any;
    if (isSeedance) {
      // Seedance 2.0 task format
      body = {
        taskType: "seedance_2",
        options: {
          name:           input.prompt.slice(0, 100),
          textPrompt:     input.prompt,
          duration:       input.duration || 5,
          resolution:     effectiveResolution,
          aspectRatio:    "9:16",
          generateAudio:  input.sound !== false,
          exploreMode:    input.exploreMode ?? false,
          creationSource: "tool-mode",
          ...(referenceImages.length > 0 && { referenceImages }),
        },
        asTeamId:  this.teamId,
        sessionId: uuidv4(),
      };
    } else {
      // Kling 3.0 task format
      body = {
        taskType,
        options: {
          name:           input.prompt.slice(0, 100),
          mode:           "std",
          textPrompt:     input.prompt,
          duration:       input.duration || 5,
          cfgScale:       input.cfgScale ?? 0.5,
          ...((referenceImages.length === 0 && !referenceVideoAsset) && { resolution: effectiveResolution }),
          providerSettings: { sound: input.sound !== false },
          exploreMode:    input.exploreMode ?? false,
          creationSource: "tool-mode",
          ...(referenceImages.length > 0 && { referenceImages }),
          ...(referenceVideoAsset && { referenceVideos: [{ assetId: referenceVideoAsset.assetId, url: referenceVideoAsset.url, durationSeconds: input.duration || 5 }] }),
        },
        asTeamId:  this.teamId,
        sessionId: uuidv4(),
      };
    }

    console.log(`[runway:task] POST /v1/tasks, referenceImages=${referenceImages.length}`);

    const proxyOpts = await this.getFetchOptions();
    const createAbort = new AbortController();
    const createTimeout = setTimeout(() => createAbort.abort(), 30000);
    let res: any;
    try {
      res = await fetch(`${API_BASE}/v1/tasks`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
        signal: createAbort.signal as any,
        ...proxyOpts,
      });
    } finally {
      clearTimeout(createTimeout);
    }

    if (res.status === 429) {
      console.warn("[runway:task] 429 rate limited");
      throw new Error("RATE_LIMITED");
    }
    if (!res.ok) {
      const text = await res.text();
      console.error(`[runway:task] create failed ${res.status}: ${text}`);
      throw new Error(`createTask ${res.status}: ${text}`);
    }

    const data = await res.json() as any;
    const taskId: string = data.task.id;
    console.log(`[runway:task] created taskId=${taskId}`);
    return { remoteTaskId: taskId };
  }

  async getTask(remoteTaskId: string): Promise<RunwayTaskStatus> {
    console.log(`[runway:poll] GET /v1/tasks/${remoteTaskId}`);
    const proxyOpts = await this.getFetchOptions();
    const getAbort = new AbortController();
    const getTimeout = setTimeout(() => getAbort.abort(), 30000);
    let res: any;
    try {
      res = await fetch(
        `${API_BASE}/v1/tasks/${remoteTaskId}?asTeamId=${this.teamId}`,
        { headers: this.headers, signal: getAbort.signal as any, ...proxyOpts }
      );
    } finally {
      clearTimeout(getTimeout);
    }
    if (!res.ok) throw new Error(`getTask ${res.status}: ${await res.text()}`);
    const data = await res.json() as any;
    const t = data.task;

    const statusMap: Record<string, RunwayTaskStatus["status"]> = {
      THROTTLED: "queued",
      PENDING:   "queued",
      RUNNING:   "processing",
      SUCCEEDED: "completed",
      FAILED:    "failed",
      CANCELLED: "cancelled",
    };

    const status = statusMap[t.status] || "processing";
    const resultUrl = t.artifacts?.[0]?.url;
    const thumbnailUrl = t.artifacts?.[0]?.previewUrls?.[0] || t.artifacts?.[0]?.metadata?.thumbnailUrl || undefined;
    const progress = typeof t.progress === "number" ? t.progress : (t.progressRatio !== undefined && t.progressRatio !== null ? parseFloat(t.progressRatio) : undefined);
    console.log(`[runway:poll] taskId=${remoteTaskId} status=${t.status}->${status} progress=${progress ?? "?"}${resultUrl ? " resultUrl="+resultUrl.split("?")[0] : ""}`);

    const errStr = (t.error && typeof t.error === 'object')
      ? [t.error.reason, t.error.errorMessage, t.error.moderation_category].filter(Boolean).join(' | ')
      : (typeof t.error === 'string' ? t.error : undefined);
    return { remoteTaskId, status, resultUrl, thumbnailUrl, errorMessage: errStr, progress };
  }

  /** Download a video artifact to a Buffer */
  async downloadVideo(artifactUrl: string): Promise<Buffer> {
    console.log(`[runway:download] fetching ${artifactUrl.split("?")[0]}`);
    const res = await timedFetch(artifactUrl, {}, TIMEOUT_ARTIFACT, "artifact download");
    if (!res.ok) throw new Error(`Download failed ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    console.log(`[runway:download] ${buf.length} bytes received`);
    return buf;
  }

  /** Check how many tasks are currently RUNNING or THROTTLED (counts toward concurrency limit) */
  async getActiveConcurrency(): Promise<number> {
    const proxyOpts = await this.getFetchOptions();
    const res = await timedFetch(
      `${API_BASE}/v1/tasks?asTeamId=${this.teamId}&limit=50`,
      { headers: this.headers, ...proxyOpts },
      TIMEOUT_GET_TASK, "list tasks"
    );
    if (!res.ok) return 0; // On error, assume slot is available
    const data = await res.json() as any;
    const active = (data.tasks || []).filter(
      (t: any) => t.status === 'RUNNING' || t.status === 'THROTTLED' || t.status === 'PENDING'
    );
    console.log(`[runway:concurrency] active tasks: ${active.length} (${active.map((t: any) => t.taskType).join(', ')})`);
    return active.length;
  }

  async cancelTask(remoteTaskId: string): Promise<void> {
    console.log(`[runway:cancel] taskId=${remoteTaskId}`);
    const proxyOpts = await this.getFetchOptions();
    await timedFetch(`${API_BASE}/v1/tasks/${remoteTaskId}/cancel?asTeamId=${this.teamId}`, {
      method: "POST",
      headers: this.headers,
      ...proxyOpts,
    }, TIMEOUT_CANCEL, "cancel task");
  }
}

