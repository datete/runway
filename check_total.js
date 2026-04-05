const { PrismaClient } = require('./services/api/node_modules/@prisma/client');
const p = new PrismaClient();
async function main() {
  const total = await p.runwayJob.count();
  const byStatus = await p.runwayJob.groupBy({ by: ['status'], _count: true });
  console.log(`All jobs total: ${total}`);
  console.log('By status:', JSON.stringify(byStatus));
  
  // Check if there's any global limit in code
  const active = await p.runwayJob.count({ where: { status: { in: ['pending', 'processing'] } } });
  console.log(`Active (pending+processing): ${active}`);
  await p.$disconnect();
}
main();
