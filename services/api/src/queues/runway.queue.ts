import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const defaultJobOptions = {
  removeOnComplete: true,
  removeOnFail: Number(process.env.BULLMQ_HISTORY_LIMIT) || 1000,
};

export const submitQueue = new Queue('runway-submit', { connection, defaultJobOptions });
export const pollQueue = new Queue('runway-poll', { connection, defaultJobOptions });
export { connection as redisConnection };
