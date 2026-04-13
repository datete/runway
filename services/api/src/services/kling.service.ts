import fetch, { Response } from "node-fetch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KlingApiResponse<T = unknown> {
  code: number;
  message?: string;
  request_id?: string;
  data: T;
}

interface KlingTaskData {
  task_id: string;
  task_status: string;
  task_status_msg?: string;
  created_at?: number;
  updated_at?: number;
  task_result?: {
    videos?: Array<{ url: string; duration: string }>;
    images?: Array<{ url: string }>;
  };
}

interface CreateVideoResult {
  taskId: string;
  status: string;
}

interface TaskStatusResult {
  taskId: string;
  status: string;
  videoUrl?: string;
  duration?: number;
  errorMessage?: string;
}

interface TextToVideoOptions {
  prompt: string;
  duration?: number;
  aspectRatio?: string;
  mode?: string;
  model?: string;
}

interface ImageToVideoOptions {
  prompt: string;
  imageUrl: string;
  duration?: number;
  aspectRatio?: string;
  mode?: string;
  model?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = "kling-v1-5";
const DEFAULT_DURATION = "5";
const DEFAULT_ASPECT_RATIO = "16:9";
const DEFAULT_MODE = "std";

function normalizeStatus(raw: string): string {
  switch (raw) {
    case "submitted":
      return "processing";
    case "succeed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return raw;
  }
}

function getBaseUrl(): string {
  const url = process.env.KLING_SERVER || "http://127.0.0.1:3002";
  return url.replace(/\/+$/, "");
}

function getApiKey(): string {
  return process.env.KLING_KEY || "";
}

async function handleResponse<T>(res: Response, context: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "<unreadable body>");
    throw new Error(
      `[kling-service] ${context} failed with HTTP ${res.status}: ${body}`
    );
  }

  const json = (await res.json()) as KlingApiResponse<T>;

  if (json.code !== 0) {
    throw new Error(
      `[kling-service] ${context} returned error code ${json.code}: ${json.message ?? "unknown error"}`
    );
  }

  return json.data;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class KlingService {
  /**
   * Create a text-to-video generation task.
   */
  async createTextToVideo(opts: TextToVideoOptions): Promise<CreateVideoResult> {
    const url = `${getBaseUrl()}/kling/v1/videos/text2video`;

    const body = {
      model_name: opts.model ?? DEFAULT_MODEL,
      prompt: opts.prompt,
      negative_prompt: "",
      duration: String(opts.duration ?? DEFAULT_DURATION),
      aspect_ratio: opts.aspectRatio ?? DEFAULT_ASPECT_RATIO,
      mode: opts.mode ?? DEFAULT_MODE,
    };

    console.log("[kling-service] POST", url, { prompt: opts.prompt });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(getApiKey() ? { Authorization: `Bearer ${getApiKey()}` } : {}),
      },
      body: JSON.stringify(body),
    });

    const data = await handleResponse<KlingTaskData>(res, "createTextToVideo");

    return {
      taskId: data.task_id,
      status: normalizeStatus(data.task_status),
    };
  }

  /**
   * Create an image-to-video generation task.
   */
  async createImageToVideo(opts: ImageToVideoOptions): Promise<CreateVideoResult> {
    const url = `${getBaseUrl()}/kling/v1/videos/image2video`;

    const body = {
      model_name: opts.model ?? DEFAULT_MODEL,
      prompt: opts.prompt,
      image: opts.imageUrl,
      duration: String(opts.duration ?? DEFAULT_DURATION),
      aspect_ratio: opts.aspectRatio ?? DEFAULT_ASPECT_RATIO,
      mode: opts.mode ?? DEFAULT_MODE,
    };

    console.log("[kling-service] POST", url, { prompt: opts.prompt, image: opts.imageUrl });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(getApiKey() ? { Authorization: `Bearer ${getApiKey()}` } : {}),
      },
      body: JSON.stringify(body),
    });

    const data = await handleResponse<KlingTaskData>(res, "createImageToVideo");

    return {
      taskId: data.task_id,
      status: normalizeStatus(data.task_status),
    };
  }

  /**
   * Poll the status of a previously created task.
   */
  async getTaskStatus(
    taskId: string,
    type: "text2video" | "image2video"
  ): Promise<TaskStatusResult> {
    const url = `${getBaseUrl()}/kling/v1/videos/${type}/${taskId}`;

    console.log("[kling-service] GET", url);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        ...(getApiKey() ? { Authorization: `Bearer ${getApiKey()}` } : {}),
      },
    });

    const data = await handleResponse<KlingTaskData>(res, `getTaskStatus(${type})`);

    const result: TaskStatusResult = {
      taskId: data.task_id,
      status: normalizeStatus(data.task_status),
    };

    if (data.task_status === "failed" && data.task_status_msg) {
      result.errorMessage = data.task_status_msg;
    }

    if (data.task_result?.videos?.[0]) {
      const video = data.task_result.videos[0];
      result.videoUrl = video.url;
      result.duration = parseFloat(video.duration);
    }

    return result;
  }

  /**
   * Create a text-to-image generation task.
   */
  async createTextToImage(opts: {
    prompt: string;
    negativePrompt?: string;
    model?: string;
  }): Promise<CreateVideoResult> {
    const url = `${getBaseUrl()}/kling/v1/images/generations`;

    const body = {
      model_name: opts.model ?? DEFAULT_MODEL,
      prompt: opts.prompt,
      negative_prompt: opts.negativePrompt ?? "",
    };

    console.log("[kling-service] POST", url, { prompt: opts.prompt });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(getApiKey() ? { Authorization: `Bearer ${getApiKey()}` } : {}),
      },
      body: JSON.stringify(body),
    });

    const data = await handleResponse<KlingTaskData>(res, "createTextToImage");

    return {
      taskId: data.task_id,
      status: normalizeStatus(data.task_status),
    };
  }

  /**
   * Poll the status of an image generation task.
   */
  async getImageTaskStatus(taskId: string): Promise<{
    taskId: string;
    status: string;
    imageUrl?: string;
    errorMessage?: string;
  }> {
    const url = `${getBaseUrl()}/kling/v1/images/generations/${taskId}`;

    console.log("[kling-service] GET", url);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        ...(getApiKey() ? { Authorization: `Bearer ${getApiKey()}` } : {}),
      },
    });

    const data = await handleResponse<KlingTaskData>(res, "getImageTaskStatus");

    const result: {
      taskId: string;
      status: string;
      imageUrl?: string;
      errorMessage?: string;
    } = {
      taskId: data.task_id,
      status: normalizeStatus(data.task_status),
    };

    if (data.task_status === "failed" && data.task_status_msg) {
      result.errorMessage = data.task_status_msg;
    }

    if (data.task_result?.images?.[0]) {
      result.imageUrl = data.task_result.images[0].url;
    }

    return result;
  }
}

export const klingService = new KlingService();
export { KlingService };
