const { PrismaClient } = require('./services/api/node_modules/@prisma/client');
const p = new PrismaClient();
async function main() {
  const users = await p.user.findMany({ select: { id: true, username: true, role: true, dailyQuota: true, totalQuota: true, maxConcurrency: true } });
  console.log(JSON.stringify(users, null, 2));
  
  // Check recent jobs per user in last 2 hours
  for (const u of users) {
    const recent = await p.runwayJob.findMany({ 
      where: { userId: u.id, createdAt: { gte: new Date(Date.now() - 7200000) } },
      select: { id: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    console.log(`\nUser ${u.username} (${u.id}): ${recent.length} jobs in last 2h`);
    recent.forEach(j => console.log(`  ${j.id.slice(0,8)} ${j.status} ${j.createdAt}`));
  }
  await p.$disconnect();
}
main();
