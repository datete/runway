import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { AccountPool } from './account-pool';

// Shared singleton instances — avoids creating multiple PrismaClient/Redis connections
export const prisma = new PrismaClient();
export const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
export const accountPool = new AccountPool(redis, prisma);
