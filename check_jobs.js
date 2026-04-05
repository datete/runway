const { PrismaClient } = require('./services/api/node_modules/@prisma/client');
const p = new PrismaClient();
async function main() {
  const jobs = await p.runwayJob.findMany({ orderBy: { createdAt: 'desc' }, take: 15, select: { id: true, status: true, userId: true, accountId: true, createdAt: true } });
  console.log(JSON.stringify(jobs, null, 2));
  await p.$disconnect();
}
main();
