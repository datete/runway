import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";
import { RunwayProvider, CreateRunwayTaskInput, RunwayTaskStatus } from "./runway.provider";

const API_BASE = "https://api.runwayml.com";

export class RunwayDirectClient implements RunwayProvider {
  private token: string;
  private teamId: number;

  constructor(token?: string, teamId?: number) {
    this.token  = token || process.env.RUNWAY_TOKEN || "";
    this.teamId = teamId || Number(process.env.RUNWAY_TEAM_ID) || 0;
    if (!this.token) throw new Error("RUNWAY_TOKEN is not set");
    if (!this.teamId) throw new Error("RUNWAY_TEAM_ID is not set");
    console.log(`[runway] client init, teamId=${this.teamId}`);
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

  /** Download an image from any URL, upload to Runway S3, return signed CloudFront URL */
  async uploadImage(sourceUrl: string): Promise<string> {
    // Convert relative /img/ paths to absolute localhost URL
    if (sourceUrl.startsWith("/")) sourceUrl = `http://localhost:5102${sourceUrl}`;
    console.log(`[runway:upload] source: ${sourceUrl}`);

    // Step 1 – download source image
    const imgRes = await fetch(sourceUrl);
    if (!imgRes.ok) throw new Error(`Failed to download image ${imgRes.status}: ${sourceUrl}`);
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    const ct = imgRes.headers.get("content-type") || "image/png";
    const ext = ct.includes("jpeg") || ct.includes("jpg") ? "jpg"
              : ct.includes("webp") ? "webp"
              : ct.includes("gif")  ? "gif"
              : "png";
    const filename = `ref_${Date.now()}.${ext}`;
    console.log(`[runway:upload] downloaded ${imgBuf.length} bytes, type=${ct}, file=${filename}`);

    // Step 2 – initiate upload
    const initRes = await fetch(`${API_BASE}/v1/uploads`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ filename, numberOfParts: 1, type: "DATASET", asTeamId: this.teamId }),
    });
    if (!initRes.ok) throw new Error(`Upload init ${initRes.status}: ${await initRes.text()}`);
    const init = await initRes.json() as any;
    const uploadId: string = init.id;
    const s3Url: string    = init.uploadUrls[0];
    console.log(`[runway:upload] initiated uploadId=${uploadId}`);

    // Step 3 – PUT to S3 presigned URL
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
    });
    if (!completeRes.ok) throw new Error(`Upload complete ${completeRes.status}: ${await completeRes.text()}`);
    const complete = await completeRes.json() as any;
    const runwayUrl: string = complete.url;
    console.log(`[runway:upload] complete, runwayUrl=${runwayUrl.split("?")[0]}`);
    return runwayUrl;
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
    console.log(`[runway:task] creating kling_3_0_standard`);
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

    const body: any = {
      taskType: "kling_3_0_standard",
      options: {
        name:           input.prompt.slice(0, 100),
        mode:           "std",
        textPrompt:     input.prompt,
        duration:       input.duration || 5,
        cfgScale:       0.5,
        ...(referenceImages.length === 0 && { resolution: input.resolution || "1280x720" }),
        providerSettings: { sound: false },
        exploreMode:    input.exploreMode ?? false,
        creationSource: "tool-mode",
        ...(referenceImages.length > 0 && { referenceImages }),
      },
      asTeamId:  this.teamId,
      sessionId: uuidv4(),
    };

    console.log(`[runway:task] POST /v1/tasks, referenceImages=${referenceImages.length}`);

    const res = await fetch(`${API_BASE}/v1/tasks`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
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
    const res = await fetch(
      `${API_BASE}/v1/tasks/${remoteTaskId}?asTeamId=${this.teamId}`,
      { headers: this.headers }
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
    console.log(`[runway:poll] taskId=${remoteTaskId} status=${t.status}→${status}${resultUrl ? " resultUrl="+resultUrl.split("?")[0] : ""}`);

    return { remoteTaskId, status, resultUrl, errorMessage: t.error || undefined };
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
    const res = await fetch(
      `${API_BASE}/v1/tasks?asTeamId=${this.teamId}&limit=50`,
      { headers: this.headers }
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
    await fetch(`${API_BASE}/v1/tasks/${remoteTaskId}/cancel?asTeamId=${this.teamId}`, {
      method: "POST",
      headers: this.headers,
    });
  }
}
