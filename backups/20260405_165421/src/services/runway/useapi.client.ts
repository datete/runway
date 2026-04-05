import fetch from 'node-fetch';
import { RunwayProvider, CreateRunwayTaskInput, RunwayTaskStatus } from './runway.provider';

export class UseApiClient implements RunwayProvider {
  private baseUrl: string;
  private token: string;

  constructor() {
    this.baseUrl = process.env.USEAPI_BASE_URL || 'https://api.useapi.net';
    this.token = process.env.USEAPI_TOKEN || '';
  }

  private get headers() {
    return { 'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json' };
  }

  async createTask(input: CreateRunwayTaskInput): Promise<{ remoteTaskId: string }> {
    const body: any = {
      prompt: input.prompt,
      model: input.modelName || 'gen4',
      exploreMode: input.exploreMode ?? true,
    };
    if (input.mode === 'image_to_video' && input.imageUrl) {
      body.firstImage = input.imageUrl;
    }
    const res = await fetch(`${this.baseUrl}/v2/runway/gen4/create`, {
      method: 'POST', headers: this.headers, body: JSON.stringify(body),
    });
    if (res.status === 429) throw new Error('RATE_LIMITED');
    if (!res.ok) throw new Error(`UseAPI createTask ${res.status}: ${await res.text()}`);
    const data = await res.json() as any;
    return { remoteTaskId: data.taskId || data.id };
  }

  async getTask(remoteTaskId: string): Promise<RunwayTaskStatus> {
    const res = await fetch(`${this.baseUrl}/v2/runway/task/${remoteTaskId}`, { headers: this.headers });
    if (!res.ok) throw new Error(`UseAPI getTask ${res.status}: ${await res.text()}`);
    const data = await res.json() as any;
    const map: Record<string, RunwayTaskStatus['status']> = {
      PENDING: 'queued', RUNNING: 'processing',
      SUCCEEDED: 'completed', FAILED: 'failed', CANCELLED: 'cancelled',
    };
    return {
      remoteTaskId,
      status: map[data.status] || 'processing',
      resultUrl: data.output?.[0] || data.resultUrl,
      thumbnailUrl: data.thumbnail,
      errorMessage: data.error,
    };
  }

  async cancelTask(remoteTaskId: string): Promise<void> {
    await fetch(`${this.baseUrl}/v2/runway/task/${remoteTaskId}/cancel`, {
      method: 'POST', headers: this.headers,
    });
  }
}
