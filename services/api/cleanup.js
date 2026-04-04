const {PrismaClient} = require('@prisma/client');
const IORedis = require('ioredis');
const p = new PrismaClient();
const redis = new IORedis();

async function main() {
  // 1. Clean zombie pending jobs (have finished_at but no remote_task_id, are pending)
  const zombies = await p.$executeRawUnsafe(`
    UPDATE runway_jobs SET status = 'failed', error_message = '僵尸任务自动清理'
    WHERE status IN ('pending', 'queued')
      AND finished_at IS NOT NULL
      AND remote_task_id IS NULL
      AND account_id IS NULL
  `);
  console.log(`Cleaned ${zombies} zombie jobs`);

  // 2. Show remaining pending/processing
  const remaining = await p.$queryRawUnsafe(`
    SELECT id, status, remote_task_id, account_id, created_at
    FROM runway_jobs
    WHERE status IN ('pending', 'queued', 'processing')
    ORDER BY created_at ASC
  `);
  console.log(`\nRemaining active jobs: ${remaining.length}`);
  for (const j of remaining) {
    console.log(`  ${j.id.slice(0,8)} status=${j.status} remote=${j.remote_task_id?.slice(0,8) || 'none'} account=${j.account_id?.slice(0,8) || 'none'}`);
  }

  // 3. Clear stale slot-released keys for jobs that are no longer processing
  const slotKeys = await redis.keys('poll:slot-released:*');
  for (const k of slotKeys) {
    const jobId = k.replace('poll:slot-released:', '');
    const job = await p.runwayJob.findUnique({ where: { id: jobId }, select: { status: true } });
    if (!job || !['processing', 'submitted'].includes(job.status)) {
      await redis.del(k);
      console.log(`Cleared stale slot-released key for ${jobId.slice(0,8)} (status=${job?.status || 'deleted'})`);
    }
  }

  // 4. Clear cooldowns to let accounts work again
  const cooldownKeys = await redis.keys('account:cooldown:*');
  for (const k of cooldownKeys) {
    await redis.del(k);
    console.log(`Cleared cooldown: ${k}`);
  }
  
  // 5. Clear global rate limit
  await redis.del('global:rate-limit-cooldown');
  console.log('Cleared global rate-limit cooldown');

  // 6. Reconcile Redis concurrency with actual processing jobs
  const accounts = await p.runwayAccount.findMany({ where: { isActive: true } });
  for (const a of accounts) {
    const active = await p.runwayJob.count({
      where: { accountId: a.id, status: { in: ['submitted', 'processing'] } }
    });
    const key = `account:concurrency:${a.id}`;
    const redisVal = parseInt(await redis.get(key) || '0');
    // Check for THROTTLED-released slots
    let throttledReleased = 0;
    const jobs = await p.$queryRawUnsafe(`SELECT id FROM runway_jobs WHERE account_id = '${a.id}' AND status = 'processing'`);
    for (const j of jobs) {
      const slotKey = `poll:slot-released:${j.id}`;
      if (await redis.get(slotKey)) throttledReleased++;
    }
    const correctRedis = Math.max(0, active - throttledReleased);
    if (redisVal !== correctRedis) {
      if (correctRedis > 0) {
        await redis.set(key, String(correctRedis), 'EX', 900);
      } else {
        await redis.del(key);
      }
      console.log(`Reconciled ${a.label}: redis ${redisVal} -> ${correctRedis} (active=${active}, throttledReleased=${throttledReleased})`);
    } else {
      console.log(`${a.label}: redis=${redisVal} correct (active=${active}, throttledReleased=${throttledReleased})`);
    }
  }

  await p.$disconnect();
  redis.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
