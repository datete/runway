const { PrismaClient } = require('./services/api/node_modules/@prisma/client');
const p = new PrismaClient();
async function main() {
  const job = await p.runwayJob.findUnique({ where: { id: '6c4e4a62-fd79-4141-88b3-998491276f28' } });
  console.log(JSON.stringify(job, null, 2));
  await p.$disconnect();
}
main();
