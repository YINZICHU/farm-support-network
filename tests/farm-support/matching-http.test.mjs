import { villageA, villageB } from '../fixture-villages.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { openStore } from '../../server/farm-support/store.mjs';
import { startFarmServer, issueInvitation } from '../../server/farm-support/http.mjs';

test('real matching endpoint requires login, origin, scope and safe masked output', async () => {
  const store = openStore(':memory:', randomBytes(32));
  const app = await startFarmServer({ store, secret: randomBytes(48).toString('hex'), port: 0 });
  const post = (data, cookie, origin = app.origin) => fetch(`${app.origin}/api/farm-support/matches`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(data),
  });
  try {
    assert.equal((await post({})).status, 401);
    const token = issueInvitation(store, { email: 'match@example.test', name: '虚构负责人', role: 'coordinator', villages: [villageA] });
    const json = (path, data) => fetch(`${app.origin}/api/farm-support${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: app.origin }, body: JSON.stringify(data) });
    assert.equal((await json('/activate', { token, password: 'Match-local-password-294!' })).status, 201);
    const login = await json('/auth/sign-in/email', { email: 'match@example.test', password: 'Match-local-password-294!' });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
    const now = Date.now(), start = now + 10800000, end = start + 3600000;
    store.transact(s => { s.program = 'OPEN'; s.villages.forEach(v => { v.state = 'OPEN'; }); });
    const actor = store.read().grants[0].userId;
    const call = (cmd, data) => app.domain.dispatch(actor, cmd, data, randomUUID());
    const p = call('person.create', { name: '虚构私密姓名', phone: '000-PRIVATE', villages: [villageA], skills: ['sorting'], verified: true, consent: true });
    call('person.availability', { id: p.id, version: p.version, start: new Date(start - 1800000).toISOString(), end: new Date(end + 1800000).toISOString(), evidence: '虚构私密核实依据', consent: true });
    let r = call('request.create', { village: villageA, household: 'DEMO-HTTP-MATCH', name: '虚构农户姓名', phone: '000-HOUSEHOLD', task: 'sorting', note: '轻量分拣', actualAt: new Date(now).toISOString(), source: 'phone', consent: true });
    r = call('request.verify', { id: r.id, version: r.version, scopeSafe: true, evidence: '虚构核实' });
    const input = { request: r.id, version: r.version, start: new Date(start).toISOString(), end: new Date(end).toISOString() };
    let response = await post(input, cookie);
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
    const result = await response.json();
    assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].id, p.id);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|HOUSEHOLD|虚构私密|虚构农户/);
    assert.equal(store.read().orders.length, 0);
    assert.equal((await post(input, cookie, 'https://evil.example')).status, 403);
    assert.equal((await post({ ...input, version: 1 }, cookie)).status, 409);
    store.transact(s => { s.requests.push({ ...r, id: 'other-village-request', village: villageB }); });
    assert.equal((await post({ ...input, request: 'other-village-request' }, cookie)).status, 403);
    store.transact(s => { s.grants[0].role = 'analyst'; });
    assert.equal((await post(input, cookie)).status, 403);
    store.transact(s => { s.grants[0].active = false; });
    assert.equal((await post(input, cookie)).status, 401);
  } finally { await app.close(); store.db.close(); }
});
