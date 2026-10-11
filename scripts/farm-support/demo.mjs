import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openStore } from '../../server/farm-support/store.mjs';
import { startFarmServer } from '../../server/farm-support/http.mjs';
import { serviceVillages } from '../../src/farm-support/model.js';

export async function createDemoRuntime({ port = 4182 } = {}) {
  if (process.env.NODE_ENV === 'production') throw Error('DEMO_PRODUCTION_DENIED');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('DEMO_INVALID_PORT');
  // Deliberately never read FARM_* variables or call production provisioning.
  const dir = mkdtempSync(join(tmpdir(), 'farm-network-fictional-demo-'));
  chmodSync(dir, 0o700);
  const store = openStore(join(dir, 'demo.sqlite'), randomBytes(32));
  let app;
  try {
    app = await startFarmServer({ store, secret: randomBytes(48).toString('hex'), port });
    const email = 'demo@example.test', password = randomBytes(32).toString('base64url');
    const { user } = await app.auth.api.createUser({ body: { email, name: '虚构演示负责人', password } });
    store.transact(s => s.grants.push({ userId: user.id, role: 'admin', villages: serviceVillages.map(v => v.id), active: true, projectAdmin: true, canCreateVillages: false, managedVillages: [], version: 1 }));
    const accessFile = join(dir, 'local-demo-access.json');
    writeFileSync(accessFile, JSON.stringify({ environment: 'local-demo', email, password, origin: app.origin }) + '\n', { flag: 'wx', mode: 0o600 });
    chmodSync(accessFile, 0o600);
    let closed = false;
    return { origin: app.origin, accessFile, async close() { if (closed) return; closed = true; try { await app.close(); } finally { store.db.close(); } } };
  } catch (error) {
    try { await app?.close(); } finally { store.db.close(); }
    throw Error(error.code === 'EADDRINUSE' ? 'DEMO_PORT_IN_USE' : 'DEMO_START_FAILED');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const demo = await createDemoRuntime();
    console.log('仅本机虚构演示：' + demo.origin + '/farm-support/manage/');
    console.log('私下在本机打开演示账号文件（不要分享）：' + demo.accessFile);
    console.log('按 Ctrl+C 停止；临时目录保留，不能用于真实资料。');
    const stop = async () => { await demo.close(); process.exit(0); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
