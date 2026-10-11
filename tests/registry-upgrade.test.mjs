import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionStorage, openProductionStore } from '../server/farm-support/production-store.mjs';
import { createAuthentication } from '../server/farm-support/auth.mjs';
import { serviceVillages } from '../src/farm-support/model.js';

async function api() {
  const module = await import('../server/farm-support/registry-upgrade.mjs').catch(() => ({}));
  assert.equal(typeof module.inspectRegistryUpgrade, 'function');
  assert.equal(typeof module.applyRegistryUpgrade, 'function');
  return module;
}
const hashes = dir => Object.fromEntries(readdirSync(dir).sort().map(n => [n, createHash('sha256').update(readFileSync(join(dir, n))).digest('hex')]));
async function legacy(t, { bootstrap = true, abort = false } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'network-upgrade-test-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const config = { dataDir, origin: 'https://upgrade.example.test', dataKey: randomBytes(32), authSecret: randomBytes(48).toString('hex'), instanceId: 'fictional-upgrade-instance' };
  await provisionStorage(config, { verifiedMount: true });
  const store = openProductionStore(config, { verifiedMount: true });
  const auth = await createAuthentication(store.db, config.authSecret, config.origin, { production: true });
  const { user } = await auth.api.createUser({ body: { email: 'owner@example.test', name: 'Fictional owner', password: 'Fictional-Upgrade-Test-Only!', data: { activationClaimId: 'bootstrap-claim' } } });
  store.transact(s => {
    s.grants = [{ userId: user.id, role: 'admin', active: true, villages: serviceVillages.map(v => v.id) }];
    s.activationClaims = bootstrap ? [{ id: 'bootstrap-claim', bootstrap: true, status: 'ACTIVE', userId: user.id, role: 'admin', villages: serviceVillages.map(v => v.id) }] : [];
    s.people = [{ id: 'fictional-person', villages: [serviceVillages[0].id], name: 'Test only' }];
    s.orders = [{ id: 'fictional-order', village: serviceVillages[0].id, status: 'DONE' }];
    for (const key of ['villageRegistryVersion', 'seedVillageIds', 'registryRevision']) delete s[key];
  });
  if (abort) {
    const revision = store.db.prepare('SELECT revision FROM fs_state').get().revision;
    store.db.exec(`CREATE TRIGGER fail_upgrade BEFORE UPDATE ON fs_state WHEN NEW.revision > ${revision + 1} BEGIN SELECT RAISE(ABORT,'fictional upgrade failure'); END;`);
  }
  const before = store.read();
  store.db.close();
  return { config, before, ownerId: user.id, verifiedMount: true, verifiedIdentity: true, backupKey: randomBytes(32) };
}

test('upgrade preserves business records and is idempotent', async t => {
  const { inspectRegistryUpgrade, applyRegistryUpgrade } = await api(), f = await legacy(t);
  const original = hashes(f.config.dataDir);
  const check = inspectRegistryUpgrade(f);
  assert.equal(check.needed, true); assert.equal(check.eligibleAdminUserId, f.ownerId);
  assert.deepEqual(hashes(f.config.dataDir), original);
  const result = await applyRegistryUpgrade(f);
  assert.equal(result.changed, true); assert.match(result.backupReceipt.sha256, /^[a-f0-9]{64}$/);
  const store = openProductionStore(f.config, f), after = store.read(); store.db.close();
  assert.deepEqual(after.people, f.before.people); assert.deepEqual(after.orders, f.before.orders);
  assert.equal(after.villageRegistryVersion, 1);
  assert.deepEqual(after.grants.filter(g => g.projectAdmin).map(g => g.userId), [f.ownerId]);
  assert.equal(after.grants[0].canCreateVillages, false); assert.deepEqual(after.grants[0].managedVillages, []);
  const unchanged = hashes(f.config.dataDir);
  assert.equal((await applyRegistryUpgrade(f)).changed, false);
  assert.deepEqual(hashes(f.config.dataDir), unchanged);
});

test('ambiguous bootstrap or wrong identity refuses before writing', async t => {
  const { inspectRegistryUpgrade, applyRegistryUpgrade } = await api(), f = await legacy(t, { bootstrap: false });
  const before = hashes(f.config.dataDir);
  assert.throws(() => inspectRegistryUpgrade(f), /UPGRADE_ADMIN_AMBIGUOUS/);
  await assert.rejects(() => applyRegistryUpgrade({ ...f, projectAdminUserId: 'unknown' }), /UPGRADE_ADMIN_INVALID/);
  await assert.rejects(() => applyRegistryUpgrade({ ...f, projectAdminUserId: f.ownerId, verifiedIdentity: false }), /IDENTITY_VERIFICATION_REQUIRED/);
  assert.throws(() => inspectRegistryUpgrade({ ...f, config: { ...f.config, instanceId: 'different-instance' } }), /STORAGE_IDENTITY/);
  assert.deepEqual(hashes(f.config.dataDir), before);
  assert.equal((await applyRegistryUpgrade({ ...f, projectAdminUserId: f.ownerId })).changed, true);
});

test('transaction failure rolls back after a verified backup', async t => {
  const { inspectRegistryUpgrade, applyRegistryUpgrade } = await api(), f = await legacy(t, { abort: true });
  await assert.rejects(() => applyRegistryUpgrade(f), /fictional upgrade failure/);
  const receipt = JSON.parse(readFileSync(join(f.config.dataDir, 'pending-backup.bundle.receipt.json'), 'utf8'));
  assert.equal(createHash('sha256').update(readFileSync(join(f.config.dataDir, 'pending-backup.bundle'))).digest('hex'), receipt.sha256);
  assert.equal(inspectRegistryUpgrade(f).needed, true);
  assert.throws(() => openProductionStore(f.config, f), /REGISTRY_UPGRADE_REQUIRED/);
});

test('pre-upgrade backup restores through an explicit verified legacy upgrade, never reactivating credentials', async t => {
  const {applyRegistryUpgrade}=await api(), f=await legacy(t);
  const result=await applyRegistryUpgrade(f);
  const {restoreRecoveryBundle}=await import('../server/farm-support/maintenance.mjs');
  const targetDir=f.config.dataDir+'-restored';t.after(()=>rmSync(targetDir,{recursive:true,force:true}));
  await restoreRecoveryBundle({config:f.config,backupKey:f.backupKey,bundleFile:join(f.config.dataDir,'pending-backup.bundle'),latestBoundaryFile:join(f.config.dataDir,'pending-backup.bundle.boundary'),expectedCheckpoint:result.backupReceipt.checkpointId,targetDir,legacyUpgrade:{verifiedIdentity:true,projectAdminUserId:f.ownerId}});
  assert.equal(existsSync(join(targetDir,'.restoring')),false);
  const restored=openProductionStore({...f.config,dataDir:targetDir},{verifiedMount:true});
  try{
    const s=restored.read();assert.equal(s.villageRegistryVersion,1);assert.deepEqual(s.people,f.before.people);assert.deepEqual(s.orders,f.before.orders);
    assert.equal(s.grants[0].projectAdmin,true);assert.equal(s.grants[0].active,false);assert.match(s.grants[0].recoveryId,/^restore-/);
    assert.equal(restored.db.prepare('SELECT count(*) AS n FROM session').get().n,0);
    assert.equal(restored.db.prepare('SELECT count(*) AS n FROM twoFactor').get().n,0);
  }finally{restored.db.close();}
});

test('legacy recovery refuses missing identity verification or an ineligible administrator',async t=>{
  const {applyRegistryUpgrade}=await api(),f=await legacy(t),result=await applyRegistryUpgrade(f);
  const {restoreRecoveryBundle}=await import('../server/farm-support/maintenance.mjs');
  for(const [suffix,legacyUpgrade,expected] of [['unverified',{verifiedIdentity:false,projectAdminUserId:f.ownerId},/IDENTITY_VERIFICATION_REQUIRED/],['wrong',{verifiedIdentity:true,projectAdminUserId:'unknown'},/UPGRADE_ADMIN_INVALID/]]){
    const targetDir=f.config.dataDir+'-'+suffix;t.after(()=>rmSync(targetDir,{recursive:true,force:true}));
    await assert.rejects(()=>restoreRecoveryBundle({config:f.config,backupKey:f.backupKey,bundleFile:join(f.config.dataDir,'pending-backup.bundle'),latestBoundaryFile:join(f.config.dataDir,'pending-backup.bundle.boundary'),expectedCheckpoint:result.backupReceipt.checkpointId,targetDir,legacyUpgrade}),expected);
    assert.throws(()=>openProductionStore({...f.config,dataDir:targetDir},{verifiedMount:true}),/RESTORE_INCOMPLETE|STORAGE_MISSING/);
  }
});
