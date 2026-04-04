const IORedis = require('ioredis');
const redis = new IORedis();

async function main() {
  // Get all account concurrency keys
  const keys = await redis.keys('account:concurrency:*');
  console.log('=== Account concurrency ===');
  for (const k of keys) {
    const val = await redis.get(k);
    const ttl = await redis.ttl(k);
    console.log(`${k} = ${val} (TTL: ${ttl}s)`);
  }
  
  // Check cooldowns
  const cooldowns = await redis.keys('account:cooldown:*');
  console.log('\n=== Account cooldowns ===');
  for (const k of cooldowns) {
    const ttl = await redis.ttl(k);
    console.log(`${k} (TTL: ${ttl}s)`);
  }
  
  // Check global rate limit
  const globalRL = await redis.get('global:rate-limit-cooldown');
  const globalTTL = await redis.ttl('global:rate-limit-cooldown');
  console.log(`\n=== Global rate limit === \nglobal:rate-limit-cooldown = ${globalRL} (TTL: ${globalTTL}s)`);
  
  // Check slot-released keys
  const slotKeys = await redis.keys('poll:slot-released:*');
  console.log(`\n=== Slot released flags (${slotKeys.length}) ===`);
  for (const k of slotKeys) {
    console.log(k);
  }
  
  // Check accounts table
  const {PrismaClient} = require('@prisma/client');
  const prisma = new PrismaClient();
  const accounts = await prisma.runwayAccount.findMany({ select: { id: true, label: true, isActive: true, maxConcurrency: true, tokenExpiresAt: true, proxyUrl: true } });
  console.log('\n=== Accounts ===');
  console.log(JSON.stringify(accounts, null, 2));
  
  await prisma.$disconnect();
  redis.disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
