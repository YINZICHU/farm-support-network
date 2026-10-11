import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identityFixture, testPassword } from './identity-fixture.mjs';
import { villageA, villageB } from './fixture-villages.mjs';
import { temporaryClient } from './static-fixture.mjs';
import { startProductionServer } from '../server/farm-support/http.mjs';
import { createActivationService } from '../server/farm-support/activation.mjs';
import { createDomain } from '../server/farm-support/domain.mjs';
import { exportRecoveryBundle, restoreRecoveryBundle } from '../server/farm-support/maintenance.mjs';
import { openProductionStore } from '../server/farm-support/production-store.mjs';
const invitation = (email, villages = [villageA], extra = {}) => ({ email, name: 'Fictional invitation', role: 'coordinator', villages, adultVerified: true, ...extra });

test('coordinator with creation capability must enroll before accessing private data', async t => {
  const f = await identityFixture(t), creator = await f.account('creator@example.test', 'coordinator', [villageA], { canCreateVillages: true });
  await f.account('ordinary@example.test', 'coordinator', [villageA]);
  const app = await startProductionServer({ ...f, clientDir: temporaryClient(t) }); t.after(() => app.close());
  let cookie = '';
  const call = (path, data) => new Promise((ok, bad) => {
    const req = request({ hostname: '127.0.0.1', port: app.port, path: '/api/farm-support' + path, method: data ? 'POST' : 'GET', headers: { host: new URL(f.config.origin).host, origin: f.config.origin, 'content-type': 'application/json', cookie } }, res => {
      if (res.headers['set-cookie']) cookie = res.headers['set-cookie'].map(v => v.split(';')[0]).join('; ');
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => ok({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    }); req.on('error', bad); req.end(data ? JSON.stringify(data) : undefined);
  });
  assert.equal((await call('/auth/sign-in/email', { email: 'creator@example.test', password: testPassword })).status, 200);
  assert.equal((await call('/account/status')).body.status, 'MFA_SETUP_REQUIRED');
  assert.equal((await call('/workspace')).status, 403);
  assert.equal((await call('/auth/two-factor/enable', { password: testPassword })).status, 200);
  assert.equal(f.store.read().grants.find(g => g.userId === creator).canCreateVillages, true);
  assert.equal((await call('/auth/sign-in/email', { email: 'ordinary@example.test', password: testPassword })).status, 200);
  assert.equal((await call('/workspace')).status, 200);
});

test('manager can invite only ordinary coordinators in managed scope', async t => {
  const f = await identityFixture(t), manager = await f.account('manager@example.test', 'coordinator', [villageA], { managedVillages: [villageA] });
  const service = createActivationService({ ...f, origin: f.config.origin });
  const token = service.issue(manager, invitation('new@example.test'));
  for (const extra of [{ role: 'admin' }, { canCreateVillages: true }, { managedVillages: [villageA] }, { role: 'admin', projectAdmin: true, projectAdminConfirmed: true }]) assert.throws(() => service.issue(manager, invitation('bad@example.test', [villageA], extra)), /FORBIDDEN/);
  assert.throws(() => service.issue(manager, invitation('outside@example.test', [villageB])), /FORBIDDEN/);
  await service.activate({ token, password: testPassword });
  const grant = f.store.read().grants.at(-1); assert.equal(grant.projectAdmin, false); assert.equal(grant.canCreateVillages, false); assert.deepEqual(grant.managedVillages, []);
});

test('issuer downgrade invalidates outstanding elevation invitation', async t => {
  const f = await identityFixture(t), root = await f.account('root@example.test', 'admin', undefined, { projectAdmin: true });
  const service = createActivationService({ ...f, origin: f.config.origin });
  const token = service.issue(root, invitation('elevated@example.test', [villageA], { canCreateVillages: true }));
  f.store.transact(s => { const g = s.grants.find(g => g.userId === root); g.projectAdmin = false; g.managedVillages = [villageA]; });
  await assert.rejects(service.activate({ token, password: testPassword }), /FORBIDDEN|INVITATION_INVALID/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 1);
});

test('root activation includes current dynamic villages and recovery uses current permission ceiling', async t => {
  const f = await identityFixture(t), root = await f.account('root@example.test', 'admin', undefined, { projectAdmin: true });
  const service = createActivationService({ ...f, origin: f.config.origin });
  const token = service.issue(root, invitation('second-root@example.test', [villageA], { role: 'admin', projectAdmin: true, projectAdminConfirmed: true }));
  const domain = createDomain(f.store), created = domain.dispatch(root, 'village.create', { zh: '虚构新增村', en: 'Fictional Added Village', evidence: 'Verified fictional authorization', registryRevision: 1 }, 'identity-new-village');
  await service.activate({ token, password: testPassword });
  assert.ok(f.store.read().grants.at(-1).villages.includes(created.id));
  const creatorToken = service.issue(root, invitation('creator-recovery@example.test', [villageA, created.id], { canCreateVillages: true, managedVillages: [created.id] }));
  await service.activate({ token: creatorToken, password: testPassword });
  const claim = f.store.read().activationClaims.at(-1), grant = f.store.read().grants.at(-1);
  domain.dispatch(root, 'grant.permissions', { ...grant, canCreateVillages: false, managedVillages: [], villages: [villageA], evidence: 'Reduced authority' }, 'identity-reduce-creator');
  const recovered = await service.recover(root, { claimId: claim.id, verifiedIdentity: true });
  await service.activate({ token: recovered.recoveryPath.split('#')[1], password: 'Fresh-Fictional-Recovery-Password!' });
  const current = f.store.read().grants.at(-1); assert.equal(current.canCreateVillages, false); assert.deepEqual(current.villages, [villageA]); assert.deepEqual(current.managedVillages, []);
});

test('old backup cannot revive removed creator permission', async t => {
  const f = await identityFixture(t), root = await f.account('root@example.test', 'admin', undefined, { projectAdmin: true });
  const creator = await f.account('creator@example.test', 'coordinator', [villageA], { canCreateVillages: true });
  const dir = mkdtempSync(join(tmpdir(), 'network-creator-restore-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const backupKey = randomBytes(32), outputFile = join(f.config.dataDir, 'pending-backup.bundle');
  const backup = async name => {
    const receipt = await exportRecoveryBundle({ ...f, backupKey, outputFile });
    const bundleFile = join(dir, name + '.bundle'), latestBoundaryFile = join(dir, name + '.boundary');
    copyFileSync(outputFile, bundleFile); copyFileSync(outputFile + '.boundary', latestBoundaryFile);
    for (const suffix of ['', '.boundary', '.receipt.json']) rmSync(outputFile + suffix);
    return { ...receipt, bundleFile, latestBoundaryFile };
  };
  const old = await backup('old'), grant = f.store.read().grants.find(g => g.userId === creator);
  createDomain(f.store).dispatch(root, 'grant.permissions', { ...grant, canCreateVillages: false, evidence: 'Authority withdrawn' }, 'restore-reduce-creator');
  const latest = await backup('latest'), targetDir = join(dir, 'restored');
  await restoreRecoveryBundle({ ...old, latestBoundaryFile: latest.latestBoundaryFile, expectedCheckpoint: latest.checkpointId, config: f.config, backupKey, targetDir });
  const restored = openProductionStore({ ...f.config, dataDir: targetDir }, { verifiedMount: true });
  try { const g = restored.read().grants.find(g => g.userId === creator); assert.equal(g.active, false); assert.equal(g.canCreateVillages, false); assert.equal(restored.db.prepare('SELECT COUNT(*) AS n FROM session').get().n, 0); } finally { restored.db.close(); }
});

test('issuer authority is checked again after asynchronous identity creation', async t => {
  const f = await identityFixture(t), root = await f.account('root@example.test', 'admin', undefined, { projectAdmin: true });
  const delayed = { ...f.auth, api: { ...f.auth.api, createUser: async args => {
    const result = await f.auth.api.createUser(args);
    f.store.transact(s => { const g = s.grants.find(g => g.userId === root); g.projectAdmin = false; g.managedVillages = [villageA]; });
    return result;
  } } };
  const service = createActivationService({ ...f, auth: delayed, origin: f.config.origin });
  const token = service.issue(root, invitation('creator-late@example.test', [villageA], { canCreateVillages: true }));
  await assert.rejects(service.activate({ token, password: testPassword }), /ACTIVATION_REQUIRES_REVIEW/);
  assert.equal(f.store.read().grants.length, 1); assert.equal(f.store.read().activationClaims.at(-1).status, 'NEEDS_RECOVERY');
});
