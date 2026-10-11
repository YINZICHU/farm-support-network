import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './farm-support/helpers.mjs';
import { openStore } from '../server/farm-support/store.mjs';
async function api() { const m = await import('../src/farm-support/permissions.js').catch(() => ({})); assert.equal(typeof m.grantCapabilities, 'function'); return m; }
test('capabilities are explicit and role constrained', async () => {
  const { grantCapabilities, requiresManagementMfa, mayManageVillage } = await api();
  assert.equal(grantCapabilities({ role: 'admin', villages: ['a', 'b'] }).projectAdmin, false);
  assert.equal(requiresManagementMfa({ role: 'coordinator', canCreateVillages: true }), true);
  assert.equal(requiresManagementMfa({ role: 'analyst', projectAdmin: true }), false);
  assert.equal(mayManageVillage({ role: 'coordinator', villages: ['a'], managedVillages: ['a', 'b'] }, 'b'), false);
});
test('last project administrator and self permission changes are denied', () => {
  const f = fixture(), g = f.store.read().grants[0];
  assert.throws(() => f.call('grant.permissions', { ...g, evidence: 'Self change', projectAdmin: false }), /CANNOT_CHANGE_SELF/);
  f.store.transact(s => s.grants[1].projectAdmin = false);
  assert.throws(() => f.call('settings.program', { state: 'PAUSED' }, 'local'), /FORBIDDEN/);
  f.store.db.close();
});
test('permission reduction survives an old database restore without expanding scope', async t => {
  await api(); const f = fixture(), dir = mkdtempSync(join(tmpdir(), 'network-permission-test-')), key = randomBytes(32), journalPath = join(dir, 'privacy.log');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let store = openStore(join(dir, 'live.sqlite'), key, { journalPath });
  store.transact(s => { Object.assign(s, f.store.read()); Object.assign(s.grants[1], { canCreateVillages: true, managedVillages: [...s.grants[1].villages] }); });
  f.store.db.close(); await store.backup(join(dir, 'old.sqlite'));
  const { createDomain } = await import('../server/farm-support/domain.mjs');
  const target = store.read().grants[1];
  createDomain(store).dispatch('adult', 'grant.permissions', { ...target, canCreateVillages: false, evidence: 'Rechecked authority' }, 'reduce-permissions-key');
  store.db.close(); store = openStore(join(dir, 'old.sqlite'), key, { journalPath });
  const recovered = store.read().grants[1]; assert.equal(recovered.canCreateVillages, false);
  assert.deepEqual(recovered.managedVillages, target.managedVillages); assert.equal(recovered.version, 2); store.db.close();
});

test('restart preserves explicit later re-grants and their newly issued sessions', async t => {
  const f=fixture(), dir=mkdtempSync(join(tmpdir(),'network-regrant-')), key=randomBytes(32), journalPath=join(dir,'privacy.log'), path=join(dir,'live.sqlite');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let store=openStore(path,key,{journalPath});
  store.transact(s=>{Object.assign(s,f.store.read());Object.assign(s.grants[1],{canCreateVillages:true,managedVillages:[...s.grants[1].villages]});});f.store.db.close();
  const {createDomain}=await import('../server/farm-support/domain.mjs'), domain=createDomain(store);
  const original=store.read().grants[1];
  domain.dispatch('adult','grant.permissions',{...original,canCreateVillages:false,managedVillages:[],villages:[original.villages[0]],evidence:'Revoked'},'regrant-reduce-key');
  domain.dispatch('adult','grant.permissions',{...store.read().grants[1],canCreateVillages:true,managedVillages:original.managedVillages,villages:original.villages,evidence:'Explicit re-authorization'},'regrant-restore-key');
  store.db.exec('CREATE TABLE session (userId TEXT)');store.db.prepare('INSERT INTO session VALUES (?)').run(original.userId);
  const expected=store.read().grants[1];store.db.close();store=openStore(path,key,{journalPath});
  assert.deepEqual(store.read().grants[1],expected);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM session').get().n,1);store.db.close();
});
