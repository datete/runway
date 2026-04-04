const fetch = require('node-fetch');
const { SocksProxyAgent } = require('socks-proxy-agent');

async function test() {
  const {PrismaClient} = require('@prisma/client');
  const p = new PrismaClient();
  const acc = await p.runwayAccount.findUnique({ where: { id: '0aa24397-7ec9-467a-92dd-35f32b1f5ce6' } });
  if (!acc) { console.log('Account not found'); return; }
  
  console.log(`Testing account: ${acc.label}`);
  console.log(`Token: ${acc.token.slice(0, 20)}...`);
  console.log(`TeamId: ${acc.teamId}`);
  console.log(`Proxy: ${acc.proxyUrl}`);
  
  try {
    const agent = new SocksProxyAgent(acc.proxyUrl);
    const res = await fetch(`https://api.runwayml.com/v1/tasks?asTeamId=${acc.teamId}&limit=1`, {
      headers: {
        'Authorization': `Bearer ${acc.token}`,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-Runway-Workspace': acc.teamId,
      },
      agent,
      timeout: 15000,
    });
    console.log(`Status: ${res.status}`);
    const text = await res.text();
    console.log(`Response: ${text.slice(0, 500)}`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
  
  await p.$disconnect();
}
test();
