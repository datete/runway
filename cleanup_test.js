const { PrismaClient } = require('./services/api/node_modules/@prisma/client');
const p = new PrismaClient();
async function main() {
  // Delete the test job we just created
  await p.runwayJob.update({ where: { id: 'e54dac98-5888-49f5-81fd-d9b250cfb582' }, data: { status: 'deleted' } });
  console.log('Test job cleaned up');
  await p.$disconnect();
}
main();
