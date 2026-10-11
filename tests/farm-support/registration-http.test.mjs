import { villageA, villageB, villageIds } from '../fixture-villages.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { openStore } from '../../server/farm-support/store.mjs';
import { startFarmServer } from '../../server/farm-support/http.mjs';
import { temporaryClient } from '../static-fixture.mjs';

const password = 'Fictional-Http-Registration-288!';
const input = { email: 'new@example.test', name: '虚构待审批负责人', villages: [villageA], consent: true };
let authClock = Date.now();
async function fixture(t, options = {}) {
  // Better Auth uses a module-wide 3-sign-ins / 10-second bucket. Simulate
  // human-paced logins without disabling either production rate limiter.
  t.mock.method(Date, 'now', () => authClock);
  const store = openStore(':memory:', randomBytes(32));
  const app = await startFarmServer({ store, secret: randomBytes(48).toString('hex'), port: 0, clientDir: temporaryClient(t), demoMail: true, ...options });
  t.after(async () => { await app.close(); store.db.close(); });
  const post = (path, body, cookie, from = app.origin) => fetch(`${app.origin}/api/farm-support${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: from, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const get = (path, cookie) => fetch(`${app.origin}/api/farm-support${path}`, { headers: cookie ? { cookie } : {} });
  const login = async email => { authClock += 11000; const res = await post('/auth/sign-in/email', { email, password }); assert.equal(res.status, 200); return res.headers.getSetCookie().map(v => v.split(';')[0]).join('; '); };
  const admin = async (villages = [villageA], email = 'admin@example.test', projectAdmin = false) => {
    const u = await app.auth.api.createUser({ body: { email, name: '虚构管理员', password, role: 'user' } });
    store.transact(s => s.grants.push({ userId: u.user.id, role: 'admin', active: true, villages, projectAdmin }));
    return login(email);
  };
  const tokenFromInbox = async cookie => {
    const res = await get('/registration/demo-mail', cookie); assert.equal(res.status, 200);
    const data = await res.json(), mail = data.messages.filter(m => m.to === input.email).at(-1);
    assert.equal(data.environment, 'local-demo');
    return new URLSearchParams(new URL(mail.verificationUrl).hash.slice(1)).get('token');
  };
  return { store, app, get, post, login, admin, tokenFromInbox };
}

test('registration HTTP flow separates verification, pending access and village approval, preserving records across login', async t => {
  const f = await fixture(t), admin = await f.admin();
  let res = await f.get('/registration/config'); assert.equal(res.status, 200); assert.equal((await res.json()).enabled, true);
  assert.equal((await f.get('/registration/demo-mail')).status, 401);
  assert.equal((await f.post('/registration/request', input, null, 'https://evil.example')).status, 403);
  res = await f.post('/registration/request', input); assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { accepted: true });
  const token = await f.tokenFromInbox(admin);
  const scanner = await fetch(`${f.app.origin}/farm-support/register/verify/#token=${token}`);
  assert.equal(scanner.status, 200); assert.equal(scanner.headers.get('cache-control'), 'no-store');
  assert.equal(f.store.read().registrations[0].used, false);
  assert.equal((await f.post('/registration/complete', { token, password })).status, 201);
  assert.equal((await f.post('/registration/complete', { token, password })).status, 409);
  let cookie = await f.login(input.email);
  res = await f.get('/account/status', cookie); assert.equal((await res.json()).status, 'PENDING');
  for (const path of ['/workspace', '/contact?type=person&id=x', '/print?id=x&recipient=farmer']) {
    const denied = await f.get(path, cookie); assert.equal(denied.status, 401); assert.equal(denied.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await denied.text(), /people|phone|requests/);
  }
  assert.equal((await f.post('/matches', { request: 'x' }, cookie)).status, 401);
  assert.equal((await f.get('/registration/applications', cookie)).status, 403);
  assert.equal((await f.get('/registration/demo-mail', cookie)).status, 403);
  const [application] = await (await f.get('/registration/applications', admin)).json();
  assert.equal(application.email, input.email); assert.equal(application.tokenHash, undefined);
  const review = { id: application.id, version: application.version, decision: 'approve', role: 'coordinator', villages: [villageA], adultVerified: true };
  assert.equal((await f.post('/registration/review', { ...review, role: 'admin' }, admin)).status, 403);
  assert.equal((await f.post('/registration/review', { ...review, villages: [villageB] }, admin)).status, 403);
  assert.equal((await f.post('/registration/review', review, admin)).status, 200);
  assert.equal((await f.post('/registration/review', review, admin)).status, 409);
  assert.equal((await f.get('/workspace', cookie)).status, 401, 'approval invalidates pending-session cookie');
  cookie = await f.login(input.email);
  res = await f.get('/workspace', cookie); const workspace = await res.json();
  assert.equal(res.status, 200); assert.deepEqual(workspace.actor.villages, [villageA]);
  res = await f.post('/command', { command: 'person.create', payload: { name: '虚构提供方', phone: '000-DEMO', villages: [villageA], skills: ['sorting'], verified: true, consent: true }, key: randomUUID() }, cookie);
  assert.equal(res.status, 200); const person = await res.json();
  await f.post('/auth/sign-out', {}, cookie); cookie = await f.login(input.email);
  assert.equal((await (await f.get('/workspace', cookie)).json()).people[0].id, person.id);
  const other = await f.admin([villageB], 'other@example.test');
  assert.deepEqual(await (await f.get('/registration/applications', other)).json(), []);
  assert.equal((await f.get(`/contact?type=person&id=${person.id}`, other)).status, 403);
  const owner = await f.admin(villageIds, 'root@example.test', true);
  assert.equal((await f.post('/command', { command: 'grant.revoke', payload: { userId: application.userId }, key: randomUUID() }, owner)).status, 200);
  assert.equal((await f.get('/workspace', cookie)).status, 401);
  cookie = await f.login(input.email);
  assert.equal((await (await f.get('/account/status', cookie)).json()).status, 'DISABLED');
  assert.equal((await f.get('/workspace', cookie)).status, 401);
});

test('unconfigured and failing mail are unavailable, direct signup remains closed, body and email limits apply', async t => {
  const f = await fixture(t, { demoMail: false });
  assert.equal((await (await f.get('/registration/config')).json()).enabled, false);
  assert.equal((await f.post('/registration/request', input)).status, 503);
  assert.equal((await f.post('/auth/sign-up/email', { ...input, password })).status, 404);
  const failed = await fixture(t, { mailer: { enabled: true, send: async () => { throw Error('private delivery error'); } } });
  let res = await failed.post('/registration/request', input); assert.equal(res.status, 503); assert.deepEqual(await res.json(), { error: 'REGISTRATION_MAIL_FAILED' });
  const live = await fixture(t);
  assert.equal((await live.post('/registration/request', { ...input, name: 'x'.repeat(33000) })).status, 413);
  for (let i = 0; i < 5; i++) assert.equal((await live.post('/registration/request', { ...input, email: i % 2 ? ' NEW@EXAMPLE.TEST ' : input.email })).status, 202);
  assert.equal((await live.post('/registration/request', input)).status, 429);
});

test('rejecting an application grants no access and exposes only its own status after relogin', async t => {
  const f = await fixture(t), admin = await f.admin();
  await f.post('/registration/request', input); const token = await f.tokenFromInbox(admin);
  await f.post('/registration/complete', { token, password });
  const [r] = await (await f.get('/registration/applications', admin)).json();
  assert.equal((await f.post('/registration/review', { id: r.id, version: r.version, decision: 'reject', adultVerified: true }, admin)).status, 200);
  const cookie = await f.login(input.email), status = await (await f.get('/account/status', cookie)).json();
  assert.equal(status.status, 'REJECTED'); assert.deepEqual(Object.keys(status).sort(), ['requestedVillages', 'status', 'userId']);
  assert.equal((await f.get('/workspace', cookie)).status, 401);
});

test('HTTP accepts an unlisted-only village request without exposing its mailbox or account to village admins', async t => {
  const f = await fixture(t);
  const localAdmin = await f.admin(), projectAdmin = await f.admin(villageIds, 'project@example.test');
  assert.equal((await f.post('/registration/request', { ...input, villages: [], otherVillage: '虚构接入村' })).status, 202);
  assert.deepEqual((await (await f.get('/registration/demo-mail', localAdmin)).json()).messages, []);
  const token = await f.tokenFromInbox(projectAdmin);
  assert.equal((await f.post('/registration/complete', { token, password })).status, 201);
  const cookie = await f.login(input.email);
  const status = await (await f.get('/account/status', cookie)).json();
  assert.equal(status.requestedOtherVillage, '虚构接入村'); assert.equal(status.status, 'PENDING');
  assert.equal((await f.get('/workspace', cookie)).status, 401);
  assert.deepEqual(await (await f.get('/registration/applications', localAdmin)).json(), []);
  const [r] = await (await f.get('/registration/applications', projectAdmin)).json();
  assert.equal(r.requestedOtherVillage, '虚构接入村');
  const decision = { id: r.id, version: r.version, adultVerified: true, decision: 'approve', role: 'coordinator', villages: [villageA] };
  assert.equal((await f.post('/registration/review', decision, localAdmin)).status, 403);
  assert.equal((await f.post('/registration/review', { ...decision, villages: ['虚构接入村'] }, projectAdmin)).status, 403);
  assert.equal((await f.get('/workspace', cookie)).status, 401);
});

test('resubmitting a known-village request does not reveal the superseded unlisted-village verification email', async t => {
  const f = await fixture(t);
  const localAdmin = await f.admin(), projectAdmin = await f.admin(villageIds, 'project@example.test');
  assert.equal((await f.post('/registration/request', { ...input, villages: [], otherVillage: '虚构接入村' })).status, 202);
  const previous = (await (await f.get('/registration/demo-mail', projectAdmin)).json()).messages[0];
  assert.deepEqual((await (await f.get('/registration/demo-mail', localAdmin)).json()).messages, []);

  assert.equal((await f.post('/registration/request', input)).status, 202);
  const current = (await (await f.get('/registration/demo-mail', localAdmin)).json()).messages;
  assert.equal(current.length, 1, 'only the current verification message is visible');
  assert.notEqual(current[0].id, previous.id);
  assert.notEqual(current[0].verificationUrl, previous.verificationUrl);
  assert.deepEqual((await (await f.get('/registration/demo-mail', projectAdmin)).json()).messages, current);
  const oldToken = new URLSearchParams(new URL(previous.verificationUrl).hash.slice(1)).get('token');
  assert.equal((await f.post('/registration/complete', { token: oldToken, password })).status, 409);
});
