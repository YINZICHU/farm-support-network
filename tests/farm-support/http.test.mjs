import { villageA, villageB } from '../fixture-villages.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { openStore } from '../../server/farm-support/store.mjs';
import { startFarmServer, issueInvitation } from '../../server/farm-support/http.mjs';
import { temporaryClient } from '../static-fixture.mjs';

test('real HTTP login enforces invitations, origin, private cache and revoked scopes', async t => {
  const store = openStore(':memory:', randomBytes(32));
  const server = await startFarmServer({ store, secret: randomBytes(48).toString('hex'), port: 0, clientDir: temporaryClient(t) });
  const { origin } = server;
  const json = (path, body, cookie, externalOrigin = origin) => fetch(`${origin}/api/farm-support${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: externalOrigin, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  try {
    const publicPage = await fetch(`${origin}/en/farm-support/`); assert.match(await publicPage.text(), /<noscript>[\s\S]*Residents do not need accounts/);
    let r = await fetch(`${origin}/api/farm-support/workspace`); assert.equal(r.status, 401); assert.match(r.headers.get('cache-control'), /no-store/);
    r = await json('/command', { command: 'request.create', payload: {}, key: 'one-action-key' }); assert.equal(r.status, 401);
    r = await json('/auth/sign-up/email', { email: 'bad@example.test', password: 'long-password-123', name: 'unauthorized' }); assert.equal(r.status, 404);
    const invite = issueInvitation(store, { email: 'coordinator@example.test', name: '虚构负责人', role: 'coordinator', villages: [villageA] });
    r = await json('/activate', { token: invite, password: 'Local-only-Password-219!' }); assert.equal(r.status, 201);
    r = await json('/activate', { token: invite, password: 'Local-only-Password-219!' }); assert.equal(r.status, 409);
    r = await json('/auth/sign-in/email', { email: 'coordinator@example.test', password: 'Local-only-Password-219!' }); assert.equal(r.status, 200);
    const cookie = r.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
    r = await fetch(`${origin}/api/farm-support/workspace`, { headers: { cookie } }); assert.equal(r.status, 200);
    const data = await r.json(); assert.equal(data.actor.role, 'coordinator'); assert.equal(data.villages.length, 1);
    r = await json('/command', { command: 'settings.program', payload: { state: 'OPEN' }, key: 'write-admin-denied' }, cookie); assert.equal(r.status, 403);
    r = await json('/command', { command: 'request.create', payload: { village: villageB }, key: 'write-village-denied' }, cookie); assert.equal(r.status, 403);
    r = await json('/command', {}, cookie, 'https://evil.example'); assert.equal(r.status, 403);
    r = await fetch(`${origin}/api/farm-support/public`); assert.equal(r.status, 200); assert.doesNotMatch(await r.text(), /coordinator@example|phone|people/);
    store.transact(s => { s.grants[0].active = false; });
    r = await fetch(`${origin}/api/farm-support/workspace`, { headers: { cookie } }); assert.equal(r.status, 401);
  } finally { await server.close(); store.db.close(); }
});

test('production startup refuses this unapproved local backend', async () => {
  await assert.rejects(() => startFarmServer({ mode: 'production' }), /LOCAL_ONLY/);
});
