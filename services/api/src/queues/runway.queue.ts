import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const submitQueue = new Queue('runway-submit', { connection });
export const pollQueue = new Queue('runway-poll', { connection });
