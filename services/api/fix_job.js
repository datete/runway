const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  // Fix 980e4da6 — has remoteTaskId from ceshiziyuan but account_id is null
  await p.$executeRawUnsafe(`
    UPDATE runway_jobs SET account_id = '0aa24397-7ec9-467a-92dd-35f32b1f5ce6', status = 'processing'
    WHERE id = '980e4da6-d5be-4cf9-82a6-0b420a51c20b' AND remote_task_id IS NOT NULL
  `);
  console.log('Fixed 980e4da6 account_id and status');
  await p.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
