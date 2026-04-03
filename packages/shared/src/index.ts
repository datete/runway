export type JobStatus = 'pending' | 'queued' | 'submitted' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type JobMode = 'text_to_video' | 'image_to_video';

export interface CreateJobInput {
  prompt: string;
  mode: JobMode;
  exploreMode?: boolean;
  model?: string;
  imageUrl?: string;
}
