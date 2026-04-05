const { PrismaClient } = require('./services/api/node_modules/@prisma/client');
const p = new PrismaClient();
async function main() {
  const userId = 'cccd2b16-952f-48a9-9857-f3cc18fe9787'; // yuanwei
  const total = await p.runwayJob.count({ where: { userId } });
  const active = await p.runwayJob.count({ where: { userId, status: { in: ['pending', 'processing'] } } });
  const completed = await p.runwayJob.count({ where: { userId, status: 'completed' } });
  const failed = await p.runwayJob.count({ where: { userId, status: 'failed' } });
  const deleted = await p.runwayJob.count({ where: { userId, status: 'deleted' } });
  console.log(`yuanwei total: ${total}, active: ${active}, completed: ${completed}, failed: ${failed}, deleted: ${deleted}`);
  
  // Check user record
  const user = await p.user.findUnique({ where: { id: userId }, select: { username: true, dailyQuota: true, totalQuota: true, maxConcurrency: true } });
  console.log('user record:', JSON.stringify(user));
  await p.$disconnect();
}
main();
