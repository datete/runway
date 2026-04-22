// One-shot migration: upgrade queued/pending std jobs to pro resolution.
// Previously ran on every runway-api startup — extracted here so it only runs when explicitly invoked.
// Run from services/api so it picks up the Prisma client from that workspace:
//   cd /root/runway/services/api && node /root/runway/scripts/upgrade-std-resolution.js
const path = require('path');
const apiDir = path.resolve(__dirname, '..', 'services', 'api');
require(path.join(apiDir, 'node_modules', 'dotenv', 'config'));
const { PrismaClient } = require(path.join(apiDir, 'node_modules', '@prisma', 'client'));

(async () => {
  const prisma = new PrismaClient();
  try {
    const result = await prisma.$executeRawUnsafe(`
      UPDATE runway_jobs SET
        resolution = CASE
          WHEN resolution = '720x1280' OR resolution IS NULL THEN '1076x1920'
          WHEN resolution = '1280x720' THEN '1920x1080'
          WHEN resolution = '960x960'  THEN '1440x1440'
          ELSE resolution
        END
      WHERE quality = 'std'
        AND status IN ('pending', 'queued')
        AND (
          resolution = '720x1280' OR resolution IS NULL
          OR resolution = '1280x720' OR resolution = '960x960'
        )
    `);
    console.log(`[migrate] updated ${result} rows`);
  } catch (e) {
    console.error('[migrate] failed:', e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
