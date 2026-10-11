import { villageA } from './fixture-villages.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, copyFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { identityFixture, testPassword } from './identity-fixture.mjs';
import { openProductionStore, storagePaths } from '../server/farm-support/production-store.mjs';
import { createActivationService } from '../server/farm-support/activation.mjs';
import { createDomain } from '../server/farm-support/domain.mjs';
async function api() {
  const m = await import('../server/farm-support/maintenance.mjs').catch(e => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
  assert.equal(typeof m.exportRecoveryBundle, 'function'); assert.equal(typeof m.restoreRecoveryBundle, 'function'); return m;
}
function archive(t) { const dir = mkdtempSync(join(tmpdir(), 'farm-custodian-test-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
async function exportBundle(m, f, key, dir, name) {
  const outputFile = join(f.config.dataDir, 'pending-backup.bundle');
  const proof = await m.exportRecoveryBundle({ ...f, outputFile, backupKey: key });
  const bundleFile = join(dir, name + '.bundle'), latestBoundaryFile = join(dir, name + '.boundary');
  copyFileSync(outputFile, bundleFile); copyFileSync(outputFile + '.boundary', latestBoundaryFile);
  // Only this test fixture's copied pending files, after simulated custodian retrieval.
  for (const suffix of ['', '.boundary', '.receipt.json']) rmSync(outputFile + suffix);
  return { ...proof, bundleFile, latestBoundaryFile };
}
test('backup is encrypted, separate-key, one-pending and requires capacity before writing', async t => {
  const m = await api(), f = await identityFixture(t), key = randomBytes(32), outputFile = join(f.config.dataDir, 'pending-backup.bundle');
  await assert.rejects(m.exportRecoveryBundle({ ...f, outputFile, backupKey: f.config.dataKey }), /SEPARATE_BACKUP_KEY/);
  m.installStorageGuard(f.store, f.config, { available: () => 100 });
  await assert.rejects(m.exportRecoveryBundle({ ...f, outputFile, backupKey: key }), /STORAGE_READ_ONLY/);
  assert.equal(existsSync(outputFile), false);
  m.installStorageGuard(f.store, f.config);
  await f.account('private-account@example.test');
  const exported = await m.exportRecoveryBundle({ ...f, outputFile, backupKey: key });
  const bytes = readFileSync(outputFile);
  for (const text of ['private-account@example.test', 'SQLite format', f.config.authSecret, f.config.dataKey.toString('base64')]) assert.equal(bytes.includes(Buffer.from(text)), false);
  assert.match(exported.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(m.exportRecoveryBundle({ ...f, outputFile, backupKey: key }), /BACKUP_PENDING/);
  await assert.rejects(m.exportRecoveryBundle({ ...f, outputFile: join(archive(t), 'public.bundle'), backupKey: key }), /PRIVATE_BACKUP_PATH/);
});
test('old database plus latest independent boundary retains deletions/revocations/consumption and clears all sessions', async t => {
  const m = await api(), f = await identityFixture(t), dir = archive(t), key = randomBytes(32);
  const admin = await f.account('owner@example.test', 'admin', undefined, { projectAdmin: true }), coordinator = await f.account('village@example.test', 'coordinator', [villageA]);
  f.store.transact(s => { s.requests.push({ id: 'r', village: villageA, household: 'fictional', name: 'Deleted fictional name', phone: 'FAKE', status: 'CLOSED', enteredAt: 1 }); });
  const service = createActivationService({ ...f, origin: f.config.origin });
  const token = service.issue(admin, { email: 'new@example.test', name: 'Fictional', role: 'coordinator', villages: [villageA], adultVerified: true });
  await f.auth.api.signInEmail({ body: { email: 'owner@example.test', password: testPassword } });
  const old = await exportBundle(m, f, key, dir, 'old');
  await service.activate({ token, password: testPassword });
  createDomain(f.store).dispatch(admin, 'grant.revoke', { userId: coordinator }, 'revoke-backup-test');
  createDomain(f.store).dispatch(admin, 'privacy.remove-contact', { type: 'request', id: 'r', reason: 'Verified fictional retention decision' }, 'delete-backup-test');
  const latest = await exportBundle(m, f, key, dir, 'latest'), targetDir = join(dir, 'restored');
  assert.deepEqual(await m.restoreRecoveryBundle({ ...old, latestBoundaryFile: latest.latestBoundaryFile, expectedCheckpoint: latest.checkpointId, config: f.config, targetDir, backupKey: key }), { sessionsCleared: true });
  const restored = openProductionStore({ ...f.config, dataDir: targetDir }, { verifiedMount: true });
  try {
    assert.equal(restored.read().requests[0].name, undefined); assert.equal(restored.read().requests[0].phone, undefined);
    assert.equal(restored.read().grants.find(g => g.userId === coordinator).active, false);
    assert.notEqual(restored.read().activationClaims[0].status, 'ISSUED');
    assert.equal(restored.db.prepare('SELECT COUNT(*) AS n FROM session').get().n, 0);
    assert.equal(restored.db.prepare('SELECT COUNT(*) AS n FROM verification').get().n, 0);
    const g = restored.read().grants.find(g => g.userId === admin); assert.equal(g.active, false); assert.ok(g.recoveryId);
  } finally { restored.db.close(); }
  await assert.rejects(m.restoreRecoveryBundle({ ...old, expectedCheckpoint: latest.checkpointId, config: f.config, targetDir: join(dir, 'stale'), backupKey: key }), /CHECKPOINT/);
  assert.equal(existsSync(join(dir, 'stale')), false);
});
test('corrupt, truncated, wrong-key/instance and occupied restore targets fail closed', async t => {
  const m = await api(), f = await identityFixture(t), dir = archive(t), key = randomBytes(32);
  const exported = await exportBundle(m, f, key, dir, 'good');
  const args = { ...exported, expectedCheckpoint: exported.checkpointId, config: f.config, targetDir: join(dir, 'target'), backupKey: key };
  await assert.rejects(m.restoreRecoveryBundle({ ...args, backupKey: randomBytes(32) }));
  await assert.rejects(m.restoreRecoveryBundle({ ...args, config: { ...f.config, instanceId: 'another-instance' } }), /IDENTITY/);
  await assert.rejects(m.restoreRecoveryBundle({ ...args, targetDir: f.config.dataDir }), /RESTORE_TARGET/);
  const damaged = join(dir, 'damaged.boundary'); writeFileSync(damaged, readFileSync(exported.latestBoundaryFile).subarray(0, -3));
  await assert.rejects(m.restoreRecoveryBundle({ ...args, latestBoundaryFile: damaged }));
  assert.equal(existsSync(args.targetDir), false);
});
test('normal startup rejects a truncated production boundary chain', async t => {
  const m = await api(), f = await identityFixture(t), paths = storagePaths(f.config);
  f.store.transact(s => { f.store.recordBoundary({ kind: 'revoke', userId: 'fixture', at: 1 }); s.audit.push({ command: 'fixture' }); });
  const saved = readFileSync(paths.journal); writeFileSync(paths.journal, '');
  assert.throws(() => openProductionStore(f.config, { verifiedMount: true }), /BOUNDARY_CHECKPOINT/);
  writeFileSync(paths.journal, saved); // Restore only this isolated fixture's bytes for cleanup.
});
test('credential recovery after the snapshot cannot resurrect the old password authorization', async t => {
  const m = await api(), f = await identityFixture(t), dir = archive(t), key = randomBytes(32), admin = await f.account('owner@example.test', 'admin', undefined, { projectAdmin: true });
  const service = createActivationService({ ...f, origin: f.config.origin });
  await service.activate({ token: service.issue(admin, { email: 'c@example.test', name: 'Fictional', role: 'coordinator', villages: [villageA], adultVerified: true }), password: testPassword });
  const claim = f.store.read().activationClaims[0], old = await exportBundle(m, f, key, dir, 'old');
  const recovered = await service.recover(admin, { claimId: claim.id, verifiedIdentity: true });
  await service.activate({ token: recovered.recoveryPath.split('#')[1], password: 'Changed-Fictional-Password!' });
  const latest = await exportBundle(m, f, key, dir, 'latest'), targetDir = join(dir, 'restored');
  await m.restoreRecoveryBundle({ ...old, latestBoundaryFile: latest.latestBoundaryFile, expectedCheckpoint: latest.checkpointId, config: f.config, targetDir, backupKey: key });
  const restored = openProductionStore({ ...f.config, dataDir: targetDir }, { verifiedMount: true });
  try { assert.equal(restored.read().grants.find(g => g.userId === claim.userId).active, false); } finally { restored.db.close(); }
});
test('backup locks business writes, rejects a moving journal, and releases its gate after failure', async t => {
  const m = await api(), f = await identityFixture(t), key = randomBytes(32), outputFile = join(f.config.dataDir, 'pending-backup.bundle');
  const original = f.store.backup;
  f.store.backup = async path => {
    assert.throws(() => f.store.transact(s => s.people.push({ id: 'concurrent' })), /MAINTENANCE_BUSY/);
    await original(path);
    writeFileSync(storagePaths(f.config).journal, 'changed');
  };
  await assert.rejects(m.exportRecoveryBundle({ ...f, outputFile, backupKey: key }), /BACKUP_CHANGED_RETRY/);
  assert.equal(f.store.maintenanceLocked, false); assert.equal(existsSync(outputFile), false);
  writeFileSync(storagePaths(f.config).journal, '');
  assert.equal(f.store.read().people.length, 0);
});
