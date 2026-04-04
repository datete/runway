const {PrismaClient} = require('@prisma/client');
const IORedis = require('ioredis');
const p = new PrismaClient();
const redis = new IORedis();

async function main() {
  const active = await p.$queryRawUnsafe(`
    SELECT id, status, remote_task_id, account_id, created_at, started_at
    FROM runway_jobs
    WHERE status IN ('processing', 'submitted', 'queued')
    ORDER BY created_at ASC
  `);
  console.log(`=== Active jobs (${active.length}) ===`);
  for (const j of active) {
    console.log(`  ${j.id.slice(0,8)} status=${j.status} remote=${j.remote_task_id?.slice(0,8) || 'none'} account=${j.account_id?.slice(0,8) || 'none'}`);
  }

  const pending = await p.$queryRawUnsafe(`SELECT count(*) as c FROM runway_jobs WHERE status = 'pending'`);
  console.log(`\nPending: ${pending[0].c}`);

  // Redis state
  const keys = await redis.keys('account:concurrency:*');
  console.log('\n=== Redis concurrency ===');
  for (const k of keys) {
    const val = await redis.get(k);
    console.log(`  ${k.split(':').pop().slice(0,8)} = ${val}`);
  }
  
  await p.$disconnect();
  redis.disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
