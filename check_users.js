const { PrismaClient } = require('./services/api/node_modules/@prisma/client');
const p = new PrismaClient();
async function main() {
  const users = await p.user.findMany({ select: { id: true, username: true, isAdmin: true, isActive: true, dailyQuota: true, totalQuota: true, maxConcurrency: true } });
  console.log(JSON.stringify(users, null, 2));
  
  // Check recent jobs per user
  for (const u of users) {
    const count = await p.runwayJob.count({ where: { userId: u.id, createdAt: { gte: new Date(Date.now() - 3600000) } } });
    console.log(`User ${u.username} (${u.id}): ${count} jobs in last hour`);
  }
  await p.$disconnect();
}
main();
