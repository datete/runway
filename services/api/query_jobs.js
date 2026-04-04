const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  // First get column names
  const cols = await p.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name='runway_jobs' ORDER BY ordinal_position`);
  console.log('Columns:', cols.map(c => c.column_name).join(', '));
  
  const jobs = await p.$queryRawUnsafe(`SELECT * FROM runway_jobs WHERE status IN ('pending','queued','processing') ORDER BY created_at DESC LIMIT 20`);
  console.log('\n--- Active jobs ---');
  console.log(JSON.stringify(jobs, null, 2));
  
  const done = await p.$queryRawUnsafe(`SELECT id, status, quality, resolution, remote_task_id, account_id, created_at, updated_at FROM runway_jobs WHERE status IN ('completed','failed') ORDER BY updated_at DESC LIMIT 10`);
  console.log('\n--- Recently completed/failed ---');
  console.log(JSON.stringify(done, null, 2));
  
  await p.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
