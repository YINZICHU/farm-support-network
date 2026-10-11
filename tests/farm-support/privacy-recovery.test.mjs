import { villageA } from '../fixture-villages.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { openStore } from '../../server/farm-support/store.mjs';
import { createDomain } from '../../server/farm-support/domain.mjs';
import { startFarmServer, issueInvitation } from '../../server/farm-support/http.mjs';

test('restoring an old snapshot reapplies separately retained contact removal and grant revocation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'farm-privacy-recovery-')), key = randomBytes(32), journalPath = join(dir, 'boundaries.enc');
  let store = openStore(join(dir, 'live.sqlite'), key, { journalPath });
  store.transact(s => { s.grants = [{ userId: 'adult', role: 'admin', villages: s.villages.map(v => v.id), active: true, projectAdmin: true }, { userId: 'old', role: 'coordinator', villages: [villageA], active: true }]; s.requests.push({ id: 'request-1', village: villageA, household: 'fictional', name: '虚构姓名', phone: 'FAKE', status: 'CLOSED', enteredAt: 1, version: 1 }); });
  await store.backup(join(dir, 'old.sqlite'));
  const domain = createDomain(store, () => Date.parse('2026-10-12T00:00:00+08:00'));
  domain.dispatch('adult', 'privacy.remove-contact', { type: 'request', id: 'request-1', reason: '成年人核实无争议，删除联系资料' }, 'remove-contact-1');
  domain.dispatch('adult', 'grant.revoke', { userId: 'old' }, 'revoke-account-1'); store.db.close();
  store = openStore(join(dir, 'old.sqlite'), key, { journalPath });
  assert.equal(store.read().grants.find(g => g.userId === 'old').active, false); assert.equal(store.read().requests[0].name, undefined); assert.equal(store.read().requests[0].phone, undefined);
  assert.throws(() => createDomain(store).snapshot('old'), /LOGIN/); store.db.close(); rmSync(dir, { recursive: true, force: true });
});

test('missing configured journal fails closed for an existing database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'farm-missing-journal-')), key = randomBytes(32), path = join(dir, 'live.sqlite');
  const store = openStore(path, key); store.db.close();
  assert.throws(() => openStore(path, key, { journalPath: join(dir, 'missing.enc') }), /JOURNAL/); rmSync(dir, { recursive: true, force: true });
});

test('invitation consumption survives restoration before activation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'farm-invite-recovery-')), key = randomBytes(32), journalPath = join(dir, 'boundaries.enc');
  let store = openStore(join(dir, 'live.sqlite'), key, { journalPath });
  store.transact(s => s.invitations.push({ id: 'invite-one', email: 'fictional@example.test', used: false, claimed: false })); await store.backup(join(dir, 'old.sqlite'));
  store.recordBoundary({ kind: 'consume-invitation', id: 'invite-one', at: Date.now() }); store.db.close();
  store = openStore(join(dir, 'old.sqlite'), key, { journalPath }); assert.equal(store.read().invitations[0].used, true); assert.equal(store.read().invitations[0].claimed, true); store.db.close(); rmSync(dir, { recursive: true, force: true });
});

test('real HTTP cannot reuse a consumed invite after restoring a preactivation snapshot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'farm-invite-http-')), key = randomBytes(32), secret = randomBytes(48).toString('hex'), journalPath = join(dir, 'boundaries.enc');
  let store = openStore(join(dir, 'live.sqlite'), key, { journalPath }), server;
  const activate = (origin, token) => fetch(`${origin}/api/farm-support/activate`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token, password: 'Fictional-local-password-91!' }) });
  try {
    server = await startFarmServer({ store, secret, port: 0 });
    store.transact(s => s.grants.push({ userId: 'adult', role: 'admin', active: true, projectAdmin: true, villages: s.villages.map(v => v.id) }));
    const token = issueInvitation(store, { name: '虚构测试协调人', email: 'fictional-recovery@example.test', role: 'coordinator', villages: [villageA] });
    await store.backup(join(dir, 'preactivation.sqlite'));
    assert.equal((await activate(server.origin, token)).status, 201);
    const userId = store.read().grants.find(g => g.userId !== 'adult').userId;
    server.domain.dispatch('adult', 'grant.revoke', { userId }, 'http-revoke-01'); await server.close(); store.db.close();
    store = openStore(join(dir, 'preactivation.sqlite'), key, { journalPath, invalidateSessions: true }); server = await startFarmServer({ store, secret, port: 0 });
    assert.equal((await activate(server.origin, token)).status, 409); assert.equal(store.read().grants.filter(g => g.userId !== 'adult').length, 0);
  } finally { if (server) await server.close(); store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('contact removal is denied for active service or unconfigured recovery journal', () => {
  const store = openStore(':memory:', randomBytes(32));
  store.transact(s => { s.grants = [{ userId: 'adult', role: 'admin', villages: [villageA], active: true }]; s.requests.push({ id: 'r', village: villageA, status: 'VERIFIED', enteredAt: 1 }); });
  assert.throws(() => createDomain(store).dispatch('adult', 'privacy.remove-contact', { type: 'request', id: 'r', reason: '未完结' }, 'remove-denied'), /RETENTION/); store.db.close();
});

test('legacy encrypted state gains an empty registration collection without losing records', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'farm-registration-legacy-')), key = randomBytes(32), path = join(dir, 'old.sqlite');
  let store = openStore(path, key);
  try {
    store.transact(s => { delete s.registrations; s.people.push({ id: 'existing-person' }); });
    store.db.close(); store = openStore(path, key);
    assert.deepEqual(store.read().registrations, []);
    assert.deepEqual(store.read().people, [{ id: 'existing-person' }]);
  } finally { store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('consumed and superseded registration links stay unusable after restoring a snapshot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'farm-registration-recovery-')), key = randomBytes(32), journalPath = join(dir, 'current.enc');
  let store = openStore(join(dir, 'live.sqlite'), key, { journalPath });
  try {
    store.transact(s => { s.registrations = [
      { id: 'r1', tokenHash: 'old-hash', used: false, claimed: false },
      { id: 'r2', tokenHash: 'consumed-hash', used: false, claimed: false },
      { id: 'r3', tokenHash: 'new-hash', used: false, claimed: false },
    ]; s.orders.push({ id: 'keep-order' }); });
    await store.backup(join(dir, 'old.sqlite'));
    store.recordBoundary({ kind: 'registration-token-invalidated', id: 'r1', tokenHash: 'old-hash', at: 1 });
    store.recordBoundary({ kind: 'registration-token-consumed', id: 'r2', tokenHash: 'consumed-hash', at: 2 });
    store.recordBoundary({ kind: 'registration-token-invalidated', id: 'r3', tokenHash: 'another-hash', at: 3 });
    store.db.close(); store = null; store = openStore(join(dir, 'old.sqlite'), key, { journalPath });
    assert.equal(store.read().registrations[0].used, true);
    assert.equal(store.read().registrations[1].claimed, true);
    assert.equal(store.read().registrations[1].used, true);
    assert.equal(store.read().registrations[2].used, false);
    assert.deepEqual(store.read().orders, [{ id: 'keep-order' }]);
  } finally { if (store) { store.db.close(); rmSync(dir, { recursive: true, force: true }); } }
});
