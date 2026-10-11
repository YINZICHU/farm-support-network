import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionStorage, openProductionStore } from '../server/farm-support/production-store.mjs';
import { createAuthentication } from '../server/farm-support/auth.mjs';
import { serviceVillages } from '../src/farm-support/model.js';

export const testPassword = 'Fictional-Identity-Test-Only!';
export async function identityFixture(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'farm-identity-test-'));
  const config = { origin: 'https://identity.example.test', port: 0, dataDir, authSecret: randomBytes(48).toString('hex'), dataKey: randomBytes(32), instanceId: 'fictional-identity-instance', mainSiteOrigin: null };
  await provisionStorage(config, { verifiedMount: true });
  const store = openProductionStore(config, { verifiedMount: true });
  const auth = await createAuthentication(store.db, config.authSecret, config.origin, { production: true });
  t.after(() => { store.db.close(); rmSync(dataDir, { recursive: true, force: true }); });
  async function account(email, role = 'admin', villages = serviceVillages.map(v => v.id), permissions = {}) {
    const { user } = await auth.api.createUser({ body: { email, name: '虚构测试负责人', password: testPassword } });
    store.transact(s => s.grants.push({ userId: user.id, role, villages, active: true, projectAdmin: false, canCreateVillages: false, managedVillages: [], version: 1, ...permissions }));
    return user.id;
  }
  return { config, store, auth, account };
}
