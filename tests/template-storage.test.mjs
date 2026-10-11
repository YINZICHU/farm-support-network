import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as storage from '../server/farm-support/production-store.mjs';
import { createDomain } from '../server/farm-support/domain.mjs';
import { openStore } from '../server/farm-support/store.mjs';
import { projectConfig } from '../src/farm-support/project-config.js';

const hashes = dir => Object.fromEntries(readdirSync(dir).sort().map(name => [name, createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')]));
test('configured stable IDs accept custom villages and renames but reject missing or duplicated stored IDs', () => {
  assert.equal(typeof storage.assertConfiguredVillageIds, 'function');
  const villages = [{ id: 'north' }, { id: 'south' }, { id: 'east' }];
  storage.assertConfiguredVillageIds({ villages: villages.map(v => ({ ...v, zh: 'renamed' })) }, villages);
  for (const stored of [[], [{ id: 'north' }], [...villages, villages[0]], [...villages, { id: 'unknown' }]]) assert.throws(() => storage.assertConfiguredVillageIds({ villages: stored }, villages), /CONFIG_VILLAGE_MISMATCH/);
});

test('empty template state is PREPARING and custom scoped users cannot write other villages or read after revocation', () => {
  const store = openStore(':memory:', randomBytes(32));
  try {
    const state = store.read();
    assert.equal(state.program, 'PREPARING');
    assert.deepEqual(state.villages.map(v => v.id), projectConfig.villages.map(v => v.id));
    assert.ok(state.villages.every(v => v.state === 'PREPARING'));
    for (const key of ['grants', 'people', 'requests', 'orders', 'bookings', 'invitations']) assert.deepEqual(state[key], []);
    store.transact(s => { s.villages = [{ id: 'north', state: 'OPEN' }, { id: 'south', state: 'OPEN' }]; s.grants = [{ userId: 'local', role: 'coordinator', villages: ['north'], active: true }]; });
    const domain = createDomain(store);
    assert.deepEqual(domain.snapshot('local').actor.villages, ['north']);
    assert.throws(() => domain.dispatch('local', 'request.create', { village: 'south' }, 'cross-scope'), /FORBIDDEN/);
    store.transact(s => { s.grants[0].active = false; });
    assert.throws(() => domain.snapshot('local'), /LOGIN_REQUIRED/);
  } finally { store.db.close(); }
});

test('production configuration drift is rejected before a writable connection and does not change storage bytes', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'network-drift-test-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const config = { dataDir, origin: 'https://example.test', instanceId: 'fictional-drift-test', authSecret: randomBytes(48).toString('hex'), dataKey: randomBytes(32) };
  await storage.provisionStorage(config, { verifiedMount: true });
  let store = storage.openProductionStore(config, { verifiedMount: true });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 0);
  store.transact(s => { s.villages[0].id = 'old-id'; }); store.db.close();
  const before = hashes(dataDir);
  assert.throws(() => storage.openProductionStore(config, { verifiedMount: true }), /CONFIG_VILLAGE_MISMATCH/);
  assert.deepEqual(hashes(dataDir), before);
  await assert.rejects(storage.provisionStorage(config, { verifiedMount: true }), /ALREADY_INITIALIZED/);
  assert.deepEqual(hashes(dataDir), before);
});

test('startup drift inspection reads committed WAL state without changing live WAL or shared-memory bytes', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'network-wal-drift-test-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const config = { dataDir, origin: 'https://example.test', instanceId: 'fictional-wal-drift', authSecret: randomBytes(48).toString('hex'), dataKey: randomBytes(32) };
  await storage.provisionStorage(config, { verifiedMount: true });
  const store = storage.openProductionStore(config, { verifiedMount: true });
  try {
    store.db.exec('PRAGMA wal_autocheckpoint=0');
    store.transact(s => { s.villages[0].id = 'only-in-wal'; });
    const before = hashes(dataDir);
    assert.ok(Object.hasOwn(before, 'farm.sqlite-wal'));
    assert.throws(() => storage.openProductionStore(config, { verifiedMount: true }), /CONFIG_VILLAGE_MISMATCH/);
    assert.deepEqual(hashes(dataDir), before);
  } finally { store.db.close(); }
});
