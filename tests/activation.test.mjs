import { villageA, villageB } from './fixture-villages.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { identityFixture, testPassword } from './identity-fixture.mjs';
import { createDomain } from '../server/farm-support/domain.mjs';

async function api() {
  const module = await import('../server/farm-support/activation.mjs').catch(e => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
  assert.equal(typeof module.createActivationService, 'function', 'durable production activation service is required');
  return module;
}
const invite = (email = 'new-coordinator@example.test', villages = [villageA]) => ({ email, name: '虚构测试协调人', role: 'coordinator', villages, adultVerified: true });
test('activation validates password before consumption and grants the exact invited villages only once', async t => {
  const { createActivationService } = await api(), f = await identityFixture(t), admin = await f.account('admin@example.test', 'admin', undefined, { projectAdmin: true });
  const service = createActivationService({ ...f, origin: f.config.origin });
  const token = service.issue(admin, invite());
  assert.equal(JSON.stringify(f.store.read()).includes(token), false);
  await assert.rejects(service.activate({ token, password: 'short' }), /INVALID_PASSWORD/);
  assert.equal(f.store.read().activationClaims[0].status, 'ISSUED');
  const results = await Promise.allSettled([service.activate({ token, password: testPassword }), service.activate({ token, password: testPassword })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const claim = f.store.read().activationClaims[0];
  assert.equal(claim.status, 'ACTIVE');
  assert.deepEqual(f.store.read().grants.find(g => g.userId === claim.userId).villages, [villageA]);
  const raw = await (await f.auth.$context).internalAdapter.findUserById(claim.userId);
  assert.equal(raw.activationClaimId, claim.id);
  await assert.rejects(service.activate({ token, password: testPassword }), /INVITATION_EXPIRED_OR_USED/);
});
test('expired activation never creates identity or grants', async t => {
  const { createActivationService } = await api(), f = await identityFixture(t), admin = await f.account('admin@example.test', 'admin', undefined, { projectAdmin: true });
  let now = Date.now(); const service = createActivationService({ ...f, origin: f.config.origin, clock: () => now });
  const token = service.issue(admin, invite()); now += 86400001;
  await assert.rejects(service.activate({ token, password: testPassword }), /INVITATION_EXPIRED_OR_USED/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 1);
  assert.equal(f.store.read().grants.length, 1);
});
test('same-email unrelated identity is never adopted, reset or granted, including recovery', async t => {
  const { createActivationService } = await api(), f = await identityFixture(t), admin = await f.account('admin@example.test', 'admin', undefined, { projectAdmin: true });
  const { user } = await f.auth.api.createUser({ body: { email: 'new-coordinator@example.test', name: 'Unrelated fictional user', password: testPassword } });
  const before = f.store.db.prepare('SELECT password FROM account WHERE userId=?').get(user.id).password;
  const service = createActivationService({ ...f, origin: f.config.origin }), token = service.issue(admin, invite());
  await assert.rejects(service.activate({ token, password: testPassword }), /ACTIVATION_REQUIRES_REVIEW/);
  await assert.rejects(service.recover(admin, { claimId: f.store.read().activationClaims[0].id, verifiedIdentity: true }), /IDENTITY_BINDING_MISMATCH/);
  assert.equal(f.store.read().grants.some(g => g.userId === user.id), false);
  assert.equal(f.store.db.prepare('SELECT password FROM account WHERE userId=?').get(user.id).password, before);
});
for (const afterCreation of [false, true]) test(`interrupted identity ${afterCreation ? 'after' : 'before'} creation requires scoped recovery and fresh self-set password`, async t => {
  const { createActivationService } = await api(), f = await identityFixture(t), admin = await f.account('admin@example.test', 'admin', undefined, { projectAdmin: true });
  // Fault injection preserves actual library side effects, then simulates process loss.
  const failingAuth = { ...f.auth, api: { ...f.auth.api, createUser: async args => { if (afterCreation) await f.auth.api.createUser(args); throw Error('SIMULATED_INTERRUPTION'); } } };
  const faulty = createActivationService({ ...f, auth: failingAuth, origin: f.config.origin });
  const token = faulty.issue(admin, invite());
  await assert.rejects(faulty.activate({ token, password: testPassword }), /ACTIVATION_REQUIRES_REVIEW/);
  const claim = f.store.read().activationClaims[0]; assert.equal(f.store.read().grants.length, 1);
  const service = createActivationService({ ...f, origin: f.config.origin });
  await assert.rejects(service.activate({ token, password: testPassword }), /INVITATION_EXPIRED_OR_USED/);
  const recovered = await service.recover(admin, { claimId: claim.id, verifiedIdentity: true });
  const freshToken = recovered.recoveryPath.split('#')[1];
  assert.ok(freshToken && freshToken !== token);
  await service.activate({ token: freshToken, password: 'Fresh-Fictional-Password-Only!' });
  assert.equal(f.store.read().grants.length, 2);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 2);
  assert.equal(f.store.read().activationClaims.find(c => c.id === claim.id).status, 'SUPERSEDED');
});
test('invitation and recovery never extend a village admin scope or reset a global administrator', async t => {
  const { createActivationService } = await api(), f = await identityFixture(t);
  const local = await f.account('local@example.test', 'admin', [villageA], { managedVillages: [villageA] }), global = await f.account('global@example.test', 'admin', undefined, { projectAdmin: true });
  const service = createActivationService({ ...f, origin: f.config.origin });
  assert.throws(() => service.issue(local, invite('other@example.test', [villageB])), /FORBIDDEN/);
  const token = service.issue(global, invite('other@example.test', [villageB]));
  await service.activate({ token, password: testPassword });
  await assert.rejects(service.recover(local, { claimId: f.store.read().activationClaims[0].id, verifiedIdentity: true }), /FORBIDDEN/);
});
test('first administrator bootstrap writes one private handoff and never silently recreates an account', async t => {
  const { bootstrapAdministrator, createActivationService } = await api(), f = await identityFixture(t);
  const handoffFile = join(f.config.dataDir, 'administrator-activation.txt');
  bootstrapAdministrator({ ...f, origin: f.config.origin, handoffFile, email: 'owner@example.test', name: 'Fictional owner', verifiedIdentity: true });
  const link = readFileSync(handoffFile, 'utf8').trim(); assert.ok(link.startsWith(f.config.origin + '/farm-support/activate/#'));
  if (process.platform !== 'win32') assert.equal(statSync(handoffFile).mode & 0o777, 0o600);
  assert.equal(f.store.read().grants.length, 0); assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 0);
  assert.throws(() => bootstrapAdministrator({ ...f, origin: f.config.origin, handoffFile, email: 'second@example.test', name: 'Other', verifiedIdentity: true }), /BOOTSTRAP_ALREADY_STARTED/);
  const service = createActivationService({ ...f, origin: f.config.origin });
  await service.activate({ token: link.split('#')[1], password: testPassword });
  const claim = f.store.read().activationClaims[0];
  assert.equal(f.store.read().grants[0].role, 'admin');
  await assert.rejects(service.recover(claim.userId, { claimId: claim.id, verifiedIdentity: true }), /CONSOLE_RECOVERY_REQUIRED/);
});
test('controlled password recovery revokes every old session and requires a fresh self-set password', async t => {
  const { createActivationService } = await api(), f = await identityFixture(t), admin = await f.account('admin@example.test', 'admin', undefined, { projectAdmin: true });
  const service = createActivationService({ ...f, origin: f.config.origin });
  await service.activate({ token: service.issue(admin, invite()), password: testPassword });
  const claim = f.store.read().activationClaims[0];
  await f.auth.api.signInEmail({ body: { email: claim.email, password: testPassword } });
  await f.auth.api.signInEmail({ body: { email: claim.email, password: testPassword } });
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM session WHERE userId=?').get(claim.userId).n, 2);
  const result = await service.recover(admin, { claimId: claim.id, verifiedIdentity: true });
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM session WHERE userId=?').get(claim.userId).n, 0);
  assert.equal(f.store.read().grants.find(g => g.userId === claim.userId).active, false);
  await service.activate({ token: result.recoveryPath.split('#')[1], password: 'Fresh-Fictional-Password-Only!' });
  await assert.rejects(f.auth.api.signInEmail({ body: { email: claim.email, password: testPassword } }));
  assert.equal(f.store.read().grants.find(g => g.userId === claim.userId).active, true);
});
test('interrupted recovery issuance can be explicitly repaired without making the old activation reusable', async t => {
  const { createActivationService } = await api(), f = await identityFixture(t), admin = await f.account('admin@example.test', 'admin', undefined, { projectAdmin: true });
  const service = createActivationService({ ...f, origin: f.config.origin }), token = service.issue(admin, invite());
  await service.activate({ token, password: testPassword });
  const claim = f.store.read().activationClaims[0];
  f.store.transact(s => { s.activationClaims[0].status = 'RECOVERING'; Object.assign(s.grants.find(g => g.userId === claim.userId), { active: false, recoveryId: 'interrupted-recovery-attempt' }); });
  const repaired = await service.recover(admin, { claimId: claim.id, verifiedIdentity: true });
  await service.activate({ token: repaired.recoveryPath.split('#')[1], password: 'Fresh-Fictional-Password-Only!' });
  await assert.rejects(service.activate({ token, password: testPassword }), /INVITATION_EXPIRED_OR_USED/);
});
test('global administrator recovery is console-only, verified, and handed off privately', async t => {
  const module = await api(), f = await identityFixture(t);
  assert.equal(typeof module.recoverAdministrator, 'function');
  const first = join(f.config.dataDir, 'initial.txt'), recovered = join(f.config.dataDir, 'recovered.txt');
  module.bootstrapAdministrator({ ...f, origin: f.config.origin, handoffFile: first, email: 'owner@example.test', name: 'Fictional owner', verifiedIdentity: true });
  const service = module.createActivationService({ ...f, origin: f.config.origin });
  await service.activate({ token: readFileSync(first, 'utf8').trim().split('#')[1], password: testPassword });
  const claim = f.store.read().activationClaims[0];
  await assert.rejects(module.recoverAdministrator({ ...f, origin: f.config.origin, handoffFile: recovered, claimId: claim.id, verifiedIdentity: false }), /IDENTITY_VERIFICATION_REQUIRED/);
  await module.recoverAdministrator({ ...f, origin: f.config.origin, handoffFile: recovered, claimId: claim.id, verifiedIdentity: true, resetMfa: true });
  assert.equal(f.store.read().grants[0].active, false);
  await service.activate({ token: readFileSync(recovered, 'utf8').trim().split('#')[1], password: 'Fresh-Fictional-Password-Only!' });
  assert.equal(f.store.read().grants[0].active, true);
});
test('password recovery cannot reactivate a revoked account or undo revocation during activation', async t => {
  const { createActivationService } = await api(), f = await identityFixture(t), admin = await f.account('admin@example.test', 'admin', undefined, { projectAdmin: true });
  const service = createActivationService({ ...f, origin: f.config.origin });
  await service.activate({ token: service.issue(admin, invite()), password: testPassword });
  const claim = f.store.read().activationClaims[0];
  const recovery = await service.recover(admin, { claimId: claim.id, verifiedIdentity: true });
  createDomain(f.store).dispatch(admin, 'grant.revoke', { userId: claim.userId }, 'revoke-during-recovery-test');
  await assert.rejects(service.activate({ token: recovery.recoveryPath.split('#')[1], password: 'Fresh-Fictional-Password-Only!' }), /ACTIVATION_REQUIRES_REVIEW/);
  assert.equal(f.store.read().grants.find(g => g.userId === claim.userId).active, false);
  const latest = f.store.read().activationClaims.at(-1);
  await assert.rejects(service.recover(admin, { claimId: latest.id, verifiedIdentity: true }), /ACCOUNT_REVOKED/);
});
test('revocation while identity lookup is pending cannot be overwritten by a recovery reservation', async t => {
  const { createActivationService } = await api(), f = await identityFixture(t), admin = await f.account('admin@example.test', 'admin', undefined, { projectAdmin: true });
  const service = createActivationService({ ...f, origin: f.config.origin });
  await service.activate({ token: service.issue(admin, invite()), password: testPassword });
  const claim = f.store.read().activationClaims[0], context = await f.auth.$context;
  const delayedAuth = { ...f.auth, $context: Promise.resolve({ ...context, adapter: { ...context.adapter, findOne: async args => {
    const result = await context.adapter.findOne(args);
    createDomain(f.store).dispatch(admin, 'grant.revoke', { userId: claim.userId }, 'lookup-revocation-test');
    return result;
  } } }) };
  const delayed = createActivationService({ ...f, auth: delayedAuth, origin: f.config.origin });
  await assert.rejects(delayed.recover(admin, { claimId: claim.id, verifiedIdentity: true }), /ACCOUNT_REVOKED/);
  const grant = f.store.read().grants.find(g => g.userId === claim.userId);
  assert.equal(grant.active, false); assert.equal(grant.recoveryId, undefined);
});
