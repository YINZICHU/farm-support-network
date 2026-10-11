import { villageA, villageB, villageIds } from '../fixture-villages.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { openStore } from '../../server/farm-support/store.mjs';
import { createAuthentication } from '../../server/farm-support/auth.mjs';

const origin = 'http://127.0.0.1:4176';
const password = 'Fictional-Registration-218!';
const input = { email: 'test@example.test', name: '虚构负责人', villages: [villageA], consent: true };
async function fixture(t, options = {}) {
  const registrationModule = await import('../../server/farm-support/registration.mjs').catch(() => ({}));
  assert.equal(typeof registrationModule.createRegistrationService, 'function', 'registration service must be implemented');
  const mailModule = await import('../../server/farm-support/mail.mjs').catch(() => ({}));
  assert.equal(typeof mailModule.createDemoMailer, 'function');
  const store = openStore(':memory:', randomBytes(32)); t.after(() => store.db.close());
  const auth = await createAuthentication(store.db, randomBytes(48).toString('hex'), origin);
  const mailer = mailModule.createDemoMailer({ origin });
  let clock = 1000000;
  const service = registrationModule.createRegistrationService({ store, auth: options.wrapAuth ? options.wrapAuth(auth) : auth, mailer: options.mailer === undefined ? mailer : options.mailer, origin, now: () => clock });
  return { store, auth, mailer, service, setTime: n => { clock = n; }, token: () => new URLSearchParams(new URL(mailer.list().at(-1).verificationUrl).hash.slice(1)).get('token') };
}

test('registration verifies one email and creates a pending identity without any grant', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.service.request({ ...input, email: ' TEST@Example.Test ' }), { accepted: true });
  const r = f.store.read().registrations[0], token = f.token();
  assert.equal(r.email, 'test@example.test'); assert.equal(r.expiresAt, 2800000);
  assert.ok(r.tokenHash); assert.ok(!JSON.stringify(f.store.read()).includes(token));
  assert.equal(new URL(f.mailer.list()[0].verificationUrl).origin, origin);
  assert.deepEqual(await f.service.complete({ token, password }), { status: 'PENDING' });
  const registered = f.store.read().registrations[0];
  assert.equal(registered.used, true); assert.equal(registered.emailVerifiedAt, 1000000);
  assert.equal(f.auth ? f.store.db.prepare('SELECT count(*) n FROM user').get().n : 0, 1);
  assert.deepEqual(f.store.read().grants, []);
  assert.equal(f.service.ownStatus(registered.userId).status, 'PENDING');
  await assert.rejects(f.service.complete({ token, password }), /REGISTRATION_LINK_INVALID/);
});

test('resend invalidates the prior link and expiration is enforced at thirty minutes', async t => {
  const f = await fixture(t); await f.service.request(input); const first = f.token();
  assert.deepEqual(await f.service.request(input), { accepted: true }); const second = f.token();
  await assert.rejects(f.service.complete({ token: first, password }), /REGISTRATION_LINK_INVALID/);
  f.setTime(2800000);
  await assert.rejects(f.service.complete({ token: second, password }), /REGISTRATION_LINK_INVALID/);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM user').get().n, 0);
});

test('existing or already verified emails are never recreated, reset or granted', async t => {
  const f = await fixture(t);
  const u = await f.auth.api.createUser({ body: { email: input.email, name: 'Original', password, role: 'user' } });
  f.store.transact(s => s.grants.push({ userId: u.user.id, role: 'coordinator', villages: [villageB], active: true }));
  const before = f.store.db.prepare('SELECT password FROM account WHERE userId=?').get(u.user.id);
  assert.deepEqual(await f.service.request(input), { accepted: true });
  assert.equal(f.mailer.list()[0].template, 'account-exists');
  assert.equal(f.mailer.list()[0].verificationUrl, undefined);
  assert.deepEqual(f.store.db.prepare('SELECT password FROM account WHERE userId=?').get(u.user.id), before);
  assert.deepEqual(f.store.read().grants[0].villages, [villageB]);
  assert.equal(f.store.read().registrations.length, 0);
});

test('concurrent complete claims the token before awaiting authentication', async t => {
  let release; const pause = new Promise(ok => { release = ok; });
  const f = await fixture(t, { wrapAuth: auth => ({ api: { createUser: async data => { await pause; return auth.api.createUser(data); } } }) });
  await f.service.request(input); const token = f.token();
  const first = f.service.complete({ token, password });
  await assert.rejects(f.service.complete({ token, password }), /REGISTRATION_LINK_INVALID/);
  release(); await first;
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM user').get().n, 1);
  assert.deepEqual(f.store.read().grants, []);
});

test('failed mail and unavailable sender never return a sent confirmation', async t => {
  const failed = await fixture(t, { mailer: { enabled: true, send: async () => { throw Error('private-provider-details'); } } });
  await assert.rejects(failed.service.request(input), e => e.code === 'REGISTRATION_MAIL_FAILED' && !e.message.includes('private-provider'));
  assert.equal(failed.store.read().registrations[0].used, true);
  const disabled = await fixture(t, { mailer: null });
  await assert.rejects(disabled.service.request(input), e => e.status === 503 && e.code === 'REGISTRATION_UNAVAILABLE');
});

test('interrupted credential provisioning cannot replay or auto-adopt the created user', async t => {
  const f = await fixture(t, { wrapAuth: auth => ({ api: { createUser: async data => { await auth.api.createUser(data); throw Error('simulated interruption'); } } }) });
  await f.service.request(input); const token = f.token();
  await assert.rejects(f.service.complete({ token, password }), /REGISTRATION_SETUP_FAILED/);
  await assert.rejects(f.service.complete({ token, password }), /REGISTRATION_LINK_INVALID/);
  await f.service.request(input);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM user').get().n, 1);
  assert.deepEqual(f.store.read().grants, []);
  assert.equal(f.store.read().registrations[0].status, 'FAILED');
});

test('approval needs a verified pending applicant, correct version and an authorized adult administrator', async t => {
  const f = await fixture(t);
  f.store.transact(s => s.grants.push({ userId: 'admin', active: true, role: 'admin', villages: [villageA] }, { userId: 'other', active: true, role: 'admin', villages: [villageB] }));
  await f.service.request(input); const unverified = f.store.read().registrations[0];
  const decision = { id: unverified.id, version: unverified.version, decision: 'approve', role: 'coordinator', villages: [villageA], adultVerified: true };
  await assert.rejects(f.service.review('admin', decision), /REGISTRATION_NOT_PENDING/);
  await f.service.complete({ token: f.token(), password });
  const [applicant] = f.service.list('admin'); decision.version = applicant.version;
  assert.deepEqual(f.service.list('other'), []);
  await assert.rejects(f.service.review('other', decision), e => e.status === 403);
  await assert.rejects(f.service.review('admin', { ...decision, role: 'admin' }), e => e.status === 403);
  await assert.rejects(f.service.review('admin', { ...decision, villages: [villageB] }), e => e.status === 403);
  await assert.rejects(f.service.review('admin', { ...decision, adultVerified: false }), e => e.status === 403);
  await f.service.review('admin', decision);
  await assert.rejects(f.service.review('admin', decision), /STALE_VERSION/);
  assert.equal(f.store.read().grants.filter(g => g.userId === applicant.userId).length, 1);
  assert.equal(f.service.ownStatus(applicant.userId).status, 'APPROVED');
  f.store.transact(s => { s.grants.find(g => g.userId === applicant.userId).active = false; });
  assert.equal(f.service.ownStatus(applicant.userId).status, 'DISABLED');
});

test('validation rejects malformed applications and weak passwords without consuming a good link', async t => {
  const f = await fixture(t);
  for (const bad of [{ email: 'bad' }, { name: '' }, { consent: false }, { villages: ['unknown'] }, { villages: [] }]) await assert.rejects(f.service.request({ ...input, ...bad }), e => e.status === 400);
  await f.service.request({ ...input, redirect: 'https://evil.example/' });
  assert.equal(new URL(f.mailer.list()[0].verificationUrl).host, '127.0.0.1:4176');
  await assert.rejects(f.service.complete({ token: f.token(), password: 'short' }), e => e.status === 400);
  assert.equal(f.store.read().registrations[0].used, false);
});

test('demo sender refuses external verification destinations', async t => {
  const f = await fixture(t);
  await assert.rejects(f.mailer.send({ to: input.email, template: 'verify', verificationUrl: 'https://evil.example/#token=stolen' }));
  assert.deepEqual(f.mailer.list(), []);
});

test('an applicant may request only an unlisted village without receiving a village grant', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.service.request({ ...input, villages: [], otherVillage: '  虚构镇新村  ' }), { accepted: true });
  let r = f.store.read().registrations[0];
  assert.deepEqual(r.requestedVillages, []); assert.equal(r.requestedOtherVillage, '虚构镇新村');
  await f.service.complete({ token: f.token(), password });
  r = f.store.read().registrations[0];
  assert.equal(f.service.ownStatus(r.userId).requestedOtherVillage, '虚构镇新村');
  assert.equal(f.service.ownStatus(r.userId).status, 'PENDING');
  assert.deepEqual(f.store.read().grants, []);
});

test('unlisted village applications are visible only to the project-wide administrator', async t => {
  const f = await fixture(t);
  const allVillages = villageIds;
  f.store.transact(s => s.grants.push(
    { userId: 'project', active: true, role: 'admin', villages: allVillages },
    { userId: 'local', active: true, role: 'admin', villages: [villageA] },
    { userId: 'duplicate', active: true, role: 'admin', villages: Array(2).fill(villageA) },
  ));
  await f.service.request({ ...input, otherVillage: '虚构新增村' });
  await f.service.complete({ token: f.token(), password });
  const [application] = f.service.list('project');
  assert.equal(application.requestedOtherVillage, '虚构新增村');
  assert.deepEqual(application.requestedVillages, [villageA]);
  assert.deepEqual(f.service.list('local'), []); assert.deepEqual(f.service.list('duplicate'), []);
  const decision = { id: application.id, version: application.version, adultVerified: true, decision: 'approve', role: 'coordinator', villages: ['虚构新增村'] };
  await assert.rejects(f.service.review('local', { ...decision, villages: [villageA] }), e => e.status === 403);
  await assert.rejects(f.service.review('project', decision), e => e.status === 403);
  assert.equal(f.service.ownStatus(application.userId).status, 'PENDING');
  await f.service.review('project', { ...decision, decision: 'reject' });
  assert.equal(f.service.ownStatus(application.userId).status, 'REJECTED');
  assert.equal(f.store.read().grants.some(g => g.userId === application.userId), false);
});

test('other village text is bounded and cannot replace valid configured village identifiers', async t => {
  const f = await fixture(t);
  for (const otherVillage of [null, {}, ['新村'], 123, '村'.repeat(81), '新\u0000村', '新\n村']) {
    await assert.rejects(f.service.request({ ...input, otherVillage }), e => e.status === 400);
  }
  await assert.rejects(f.service.request({ ...input, villages: [], otherVillage: '   ' }), e => e.status === 400);
  await assert.rejects(f.service.request({ ...input, villages: ['invented-id'], otherVillage: '新村' }), e => e.status === 400);
  assert.equal(f.store.read().registrations.length, 0);
  await f.service.request({ ...input, villages: [], otherVillage: '村'.repeat(80) });
  assert.equal(f.store.read().registrations[0].requestedOtherVillage.length, 80);
});

test('resubmitting a known-village request clears an earlier unlisted village preference', async t => {
  const f = await fixture(t);
  await f.service.request({ ...input, otherVillage: '虚构新增村' });
  assert.equal(f.store.read().registrations[0].requestedOtherVillage, '虚构新增村');
  await f.service.request(input);
  assert.equal(f.store.read().registrations[0].requestedOtherVillage, '');
  assert.deepEqual(f.store.read().registrations[0].requestedVillages, [villageA]);
});
