const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  const accs = await p.runwayAccount.findMany({ where: { isActive: true }, orderBy: [{ priority: 'desc' }, { lastUsedAt: 'asc' }] });
  for (const a of accs) {
    console.log(`${a.label}: priority=${a.priority}, lastUsedAt=${a.lastUsedAt?.toISOString() || 'null'}`);
  }
  await p.$disconnect();
}
main();
