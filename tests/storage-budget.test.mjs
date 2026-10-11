import test from 'node:test';
import assert from 'node:assert/strict';
import { identityFixture } from './identity-fixture.mjs';
import { createDomain } from '../server/farm-support/domain.mjs';
const MiB = 1024 ** 2;
async function api() {
  const m = await import('../server/farm-support/maintenance.mjs').catch(e => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
  assert.equal(typeof m.storageBudget, 'function'); return m;
}
test('storage budgets reject exhausted/invalid headroom and oversized state or journal without expansion', async () => {
  const { storageBudget } = await api(), healthy = { availableBytes: 128 * MiB, stateBytes: 8 * MiB, journalBytes: 16 * MiB };
  assert.deepEqual(storageBudget(healthy), { acceptWrites: true, reason: null });
  for (const input of [{ availableBytes: 128 * MiB - 1 }, { stateBytes: 8 * MiB + 1 }, { journalBytes: 16 * MiB + 1 }, { availableBytes: NaN }, { stateBytes: -1 }]) assert.equal(storageBudget({ ...healthy, ...input }).acceptWrites, false);
});
test('low-space protection rejects mutations but permits bounded authorized snapshot and rollback', async t => {
  const { installStorageGuard } = await api(), f = await identityFixture(t), admin = await f.account('space-admin@example.test');
  const before = f.store.read();
  installStorageGuard(f.store, f.config, { available: () => 127 * MiB });
  assert.throws(() => f.store.transact(s => s.people.push({ id: 'not-saved' })), /STORAGE_READ_ONLY/);
  assert.deepEqual(f.store.read(), before);
  assert.equal(createDomain(f.store).snapshot(admin).summary.storageReadOnly, true);
  assert.throws(() => createDomain(f.store).snapshot('unapproved'), /LOGIN_REQUIRED/);
  installStorageGuard(f.store, f.config, { available: () => 512 * MiB });
  assert.throws(() => f.store.transact(s => { s.audit.push({ text: 'x'.repeat(8 * MiB) }); }), /STORAGE_READ_ONLY/);
  assert.deepEqual(f.store.read(), before);
});
test('sqlite write failure never returns saved or commits part of the business state', async t => {
  await api(); const f = await identityFixture(t), before = f.store.read();
  f.store.db.exec('PRAGMA query_only=ON');
  assert.throws(() => f.store.transact(s => { s.people.push({ id: 'never-saved' }); s.program = 'OPEN'; }));
  assert.deepEqual(f.store.read(), before);
  f.store.db.exec('PRAGMA query_only=OFF');
});
