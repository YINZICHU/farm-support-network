// Run in a fresh process, without editing any project file or production path.
import input from '../config/project.json' with { type: 'json' };
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const count = Number(process.argv[2]);
assert.ok([1, 2, 3].includes(count));
input.villages = ['north', 'south', 'east'].slice(0, count).map(id => ({ id, zh: '虚构 ' + id, en: 'Fictional ' + id }));
const { projectConfig } = await import('../src/farm-support/project-config.js');
assert.equal(projectConfig.villages.length, count);
const { provisionStorage, openProductionStore } = await import('../server/farm-support/production-store.mjs');
const { createAuthentication } = await import('../server/farm-support/auth.mjs');
const { createActivationService } = await import('../server/farm-support/activation.mjs');
const { createDomain } = await import('../server/farm-support/domain.mjs');
const dataDir = mkdtempSync(join(tmpdir(), 'network-custom-configuration-'));
const config = { dataDir, origin: 'https://custom.example.test', instanceId: 'fictional-custom-config', authSecret: randomBytes(48).toString('hex'), dataKey: randomBytes(32) };
let store;
try {
  await provisionStorage(config, { verifiedMount: true });
  store = openProductionStore(config, { verifiedMount: true });
  assert.equal(store.read().program, 'PREPARING');
  assert.deepEqual(store.read().villages.map(v => v.id), input.villages.map(v => v.id));
  assert.deepEqual(store.read().people, []);
  const auth = await createAuthentication(store.db, config.authSecret, config.origin, { production: true });
  const { user } = await auth.api.createUser({ body: { email: 'owner@example.test', name: 'Fictional owner', password: 'Fictional-Config-Test-Only!' } });
  store.transact(s => s.grants.push({ userId: user.id, role: 'admin', active: true, villages: input.villages.map(v => v.id), projectAdmin: true, canCreateVillages: false, managedVillages: [], version: 1 }));
  const service = createActivationService({ store, auth, origin: config.origin });
  const token = service.issue(user.id, { email: 'coordinator@example.test', name: 'Fictional coordinator', role: 'coordinator', villages: ['north'], adultVerified: true });
  await service.activate({ token, password: 'Fictional-Coordinator-Test-Only!' });
  const claim = store.read().activationClaims.find(i => i.email === 'coordinator@example.test');
  assert.deepEqual(store.read().grants.find(g => g.userId === claim.userId).villages, ['north']);
  const domain = createDomain(store);
  assert.throws(() => domain.dispatch(claim.userId, 'request.create', { village: count > 1 ? 'south' : 'not-configured' }, 'cross-scope'), /FORBIDDEN/);
  store.transact(s => { s.grants.find(g => g.userId === claim.userId).active = false; });
  assert.throws(() => domain.snapshot(claim.userId), /LOGIN_REQUIRED/);
  store.db.close(); store = openProductionStore(config, { verifiedMount: true });
  assert.deepEqual(store.read().villages.map(v => v.id), input.villages.map(v => v.id));
  if (count > 1) {
    const { fixture } = await import('./farm-support/helpers.mjs');
    const f = fixture();
    try { assert.equal(f.request().village, 'north'); assert.throws(() => f.call('request.create', { village: 'south' }, 'local'), /FORBIDDEN/); }
    finally { f.store.db.close(); }
  }
  console.log(JSON.stringify({ configuredVillages: count, initialized: true, invitationActivated: true, revoked: true }));
} finally { store?.db.close(); rmSync(dataDir, { recursive: true, force: true }); }
