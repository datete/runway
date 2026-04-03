import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";
import { RunwayProvider, CreateRunwayTaskInput, RunwayTaskStatus } from "./runway.provider";

const API_BASE = "https://api.runwayml.com";

export class RunwayDirectClient implements RunwayProvider {
  private token: string;
  private teamId: number;
  private proxyUrl?: string;

  constructor(token?: string, teamId?: number, proxyUrl?: string) {
    this.token  = token || process.env.RUNWAY_TOKEN || "";
    this.teamId = teamId || Number(process.env.RUNWAY_TEAM_ID) || 0;
    this.proxyUrl = proxyUrl;
    if (!this.token) throw new Error("RUNWAY_TOKEN is not set");
    if (!this.teamId) throw new Error("RUNWAY_TEAM_ID is not set");
    console.log(`[runway] client init, teamId=${this.teamId}${this.proxyUrl ? ', proxy=' + this.proxyUrl.split('@').pop() : ''}`);
  }

  private get headers() {
    return {
      "Authorization":              `Bearer ${this.token}`,
      "Content-Type":               "application/json",
      "Accept":                     "application/json",
      "X-Runway-Workspace":         String(this.teamId),
      "X-Runway-Source-Application":"web",
    };
  }

  /** Get fetch options with proxy agent if configured */
  private async getFetchOptions(): Promise<{ agent?: any }> {
    if (!this.proxyUrl) return {};
    try {
      if (this.proxyUrl.startsWith('socks')) {
        const { SocksProxyAgent } = await import('socks-proxy-agent');
        return { agent: new SocksProxyAgent(this.proxyUrl) };
      } else {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        return { agent: new HttpsProxyAgent(this.proxyUrl) };
      }
    } catch (e: any) {
      console.warn(`[runway] proxy agent init failed: ${e.message}, using direct connection`);
      return {};
    }
  }

  /** Download an image from any URL, upload to Runway S3, return signed CloudFront URL */
  async uploadImage(sourceUrl: string): Promise<string> {
    // Convert relative /img/ paths to absolute localhost URL
    if (sourceUrl.startsWith("/")) sourceUrl = `http://localhost:5102${sourceUrl}`;
    console.log(`[runway:upload] source: ${sourceUrl}`);

    // Step 1 – download source image (no proxy needed for local/external image download)
    const imgRes = await fetch(sourceUrl);
    if (!imgRes.ok) throw new Error(`Failed to download image ${imgRes.status}: ${sourceUrl}`);
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    const ct = imgRes.headers.get("content-type") || "image/png";
    const ext = ct.includes("jpeg") || ct.includes("jpg") ? "jpg"
              : ct.includes("webp") ? "webp"
              : ct.includes("gif")  ? "gif"
              : ct.includes("mp4")  ? "mp4"
              : ct.includes("video") ? "mp4"
              : "png";
    const filename = `ref_${Date.now()}.${ext}`;
    console.log(`[runway:upload] downloaded ${imgBuf.length} bytes, type=${ct}, file=${filename}`);

    const proxyOpts = await this.getFetchOptions();

    // Step 2 – initiate upload
    const initRes = await fetch(`${API_BASE}/v1/uploads`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ filename, numberOfParts: 1, type: "DATASET", asTeamId: this.teamId }),
      ...proxyOpts,
    });
    if (!initRes.ok) throw new Error(`Upload init ${initRes.status}: ${await initRes.text()}`);
    const init = await initRes.json() as any;
    const uploadId: string = init.id;
    const s3Url: string    = init.uploadUrls[0];
    console.log(`[runway:upload] initiated uploadId=${uploadId}`);

    // Step 3 – PUT to S3 presigned URL (S3 direct, no proxy needed)
    const putRes = await fetch(s3Url, {
      method: "PUT",
      headers: { "Content-Type": ct },
      body: imgBuf,
    });
    if (!putRes.ok) throw new Error(`S3 PUT ${putRes.status}`);
    const etag = (putRes.headers.get("ETag") || "").replace(/"/g, "");
    console.log(`[runway:upload] S3 PUT ok, ETag=${etag}`);

    // Step 4 – complete upload
    const completeRes = await fetch(`${API_BASE}/v1/uploads/${uploadId}/complete`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ parts: [{ PartNumber: 1, ETag: etag }], asTeamId: this.teamId }),
      ...proxyOpts,
    });
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

    const imgRes = await fetch(sourceUrl);
    if (!imgRes.ok) throw new Error(`Failed to download file ${imgRes.status}: ${sourceUrl}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const ct = imgRes.headers.get("content-type") || "video/mp4";
    const ext = ct.includes("mp4") || ct.includes("video") ? "mp4" : "mp4";
    const filename = `ref_${Date.now()}.${ext}`;
    console.log(`[runway:upload:video] downloaded ${buf.length} bytes, type=${ct}`);

    const proxyOpts = await this.getFetchOptions();

    const initRes = await fetch(`${API_BASE}/v1/uploads`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ filename, numberOfParts: 1, type: "DATASET", asTeamId: this.teamId }),
      ...proxyOpts,
    });
    if (!initRes.ok) throw new Error(`Upload init ${initRes.status}: ${await initRes.text()}`);
    const init = await initRes.json() as any;
    const uploadId: string = init.id;
    const s3Url: string = init.uploadUrls[0];

    const putRes = await fetch(s3Url, {
      method: "PUT",
      headers: { "Content-Type": ct },
      body: buf,
    });
    if (!putRes.ok) throw new Error(`S3 PUT ${putRes.status}`);
    const etag = (putRes.headers.get("ETag") || "").replace(/"/g, "");

    const completeRes = await fetch(`${API_BASE}/v1/uploads/${uploadId}/complete`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ parts: [{ PartNumber: 1, ETag: etag }], asTeamId: this.teamId }),
      ...proxyOpts,
    });
    if (!completeRes.ok) throw new Error(`Upload complete ${completeRes.status}: ${await completeRes.text()}`);
    const complete = await completeRes.json() as any;
    console.log(`[runway:upload:video] complete, assetId=${uploadId}, url=${(complete.url || "").split("?")[0]}`);
    return { url: complete.url, assetId: uploadId };
  }

  /** Upload any file (image or video) to Runway S3 */
  async uploadFile(sourceUrl: string): Promise<string> {
    return this.uploadImage(sourceUrl);
  }

  /** Upload multiple images and return referenceImages array for task creation */
  private async uploadReferenceImages(urls: string[]): Promise<Array<{ url: string }>> {
    console.log(`[runway] uploading ${urls.length} reference image(s)`);
    const results: Array<{ url: string }> = [];
    for (let i = 0; i < urls.length; i++) {
      console.log(`[runway] image ${i + 1}/${urls.length}: ${urls[i]}`);
      const runwayUrl = await this.uploadImage(urls[i]);
      results.push({ url: runwayUrl });
      console.log(`[runway] image ${i + 1} uploaded ok`);
    }
    return results;
  }

  async createTask(input: CreateRunwayTaskInput): Promise<{ remoteTaskId: string }> {
    const isPro = input.quality === "pro";
    const taskType = isPro ? "kling_3_0_pro" : "kling_3_0_standard";
    console.log(`[runway:task] creating ${taskType} (quality=${input.quality || "std"})`);
    console.log(`[runway:task] prompt: "${input.prompt.slice(0, 80)}"`);
    console.log(`[runway:task] duration=${input.duration || 5}s, exploreMode=${input.exploreMode ?? true}`);

    // Collect all source image URLs
    const sourceUrls: string[] = [
      ...(input.imageUrls || []),
      ...(input.imageUrl && !input.imageUrls ? [input.imageUrl] : []),
    ].filter(Boolean);

    console.log(`[runway:task] reference images to upload: ${sourceUrls.length}`);

    // Upload images to Runway
    let referenceImages: Array<{ url: string }> = [];
    if (sourceUrls.length > 0) {
      referenceImages = await this.uploadReferenceImages(sourceUrls);
    }

    // Upload reference video for pro mode
    let referenceVideoAsset: { url: string; assetId: string } | undefined;
    if (input.videoUrl) {
      console.log(`[runway:task] uploading reference video: ${input.videoUrl}`);
      referenceVideoAsset = await this.uploadFileWithAsset(input.videoUrl);
      console.log(`[runway:task] reference video uploaded, assetId=${referenceVideoAsset.assetId}`);
    }

    // Use resolution from frontend directly; fallback to defaults if missing
    const defaultRes = isPro ? "1080x1920" : "720x1280";
    const stdToProRes: Record<string, string> = { "720x1280": "1080x1920", "1280x720": "1920x1080", "960x960": "1440x1440" };
    const effectiveResolution = input.resolution
      ? (isPro && stdToProRes[input.resolution] ? stdToProRes[input.resolution] : input.resolution)
      : defaultRes;

    const body: any = {
      taskType,
      options: {
        name:           input.prompt.slice(0, 100),
        mode:           isPro ? "std" : (input.quality || "std"),
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

    console.log(`[runway:task] POST /v1/tasks, referenceImages=${referenceImages.length}`);

    const proxyOpts = await this.getFetchOptions();
    const res = await fetch(`${API_BASE}/v1/tasks`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
      ...proxyOpts,
    });

    if (res.status === 429) {
      console.warn("[runway:task] 429 rate limited");
      throw new Error("RATE_LIMITED");
    }
    if (!res.ok) {
      const text = await res.text();
      console.error(`[runway:task] create failed ${res.status}: ${text}`);
      throw new Error(`Runway createTask ${res.status}: ${text}`);
    }

    const data = await res.json() as any;
    const taskId: string = data.task.id;
    console.log(`[runway:task] created taskId=${taskId}`);
    return { remoteTaskId: taskId };
  }

  async getTask(remoteTaskId: string): Promise<RunwayTaskStatus> {
    console.log(`[runway:poll] GET /v1/tasks/${remoteTaskId}`);
    const proxyOpts = await this.getFetchOptions();
    const res = await fetch(
      `${API_BASE}/v1/tasks/${remoteTaskId}?asTeamId=${this.teamId}`,
      { headers: this.headers, ...proxyOpts }
    );
    if (!res.ok) throw new Error(`Runway getTask ${res.status}: ${await res.text()}`);
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

    return { remoteTaskId, status, resultUrl, thumbnailUrl, errorMessage: t.error || undefined, progress };
  }

  /** Download a video artifact to a Buffer */
  async downloadVideo(artifactUrl: string): Promise<Buffer> {
    console.log(`[runway:download] fetching ${artifactUrl.split("?")[0]}`);
    const res = await fetch(artifactUrl);
    if (!res.ok) throw new Error(`Download failed ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    console.log(`[runway:download] ${buf.length} bytes received`);
    return buf;
  }

  /** Check how many tasks are currently RUNNING or THROTTLED (counts toward concurrency limit) */
  async getActiveConcurrency(): Promise<number> {
    const proxyOpts = await this.getFetchOptions();
    const res = await fetch(
      `${API_BASE}/v1/tasks?asTeamId=${this.teamId}&limit=50`,
      { headers: this.headers, ...proxyOpts }
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
    await fetch(`${API_BASE}/v1/tasks/${remoteTaskId}/cancel?asTeamId=${this.teamId}`, {
      method: "POST",
      headers: this.headers,
      ...proxyOpts,
    });
  }
}
