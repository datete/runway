export interface CreateRunwayTaskInput {
  prompt: string;
  mode: "text_to_video" | "image_to_video";
  imageUrl?: string;          // single legacy ref
  imageUrls?: string[];       // multiple reference images (uploaded to Runway internally)
  duration?: number;          // seconds: 5 or 10
  exploreMode?: boolean;
  modelName?: string;
}

export interface RunwayTaskStatus {
  remoteTaskId: string;
  status: "queued" | "submitted" | "processing" | "completed" | "failed" | "cancelled";
  resultUrl?: string;
  thumbnailUrl?: string;
  errorMessage?: string;
}

export interface RunwayProvider {
  createTask(input: CreateRunwayTaskInput): Promise<{ remoteTaskId: string }>;
  getTask(remoteTaskId: string): Promise<RunwayTaskStatus>;
  cancelTask?(remoteTaskId: string): Promise<void>;
}
