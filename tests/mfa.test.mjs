import { villageA } from './fixture-villages.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { identityFixture, testPassword } from './identity-fixture.mjs';
import { temporaryClient } from './static-fixture.mjs';
import { startProductionServer } from '../server/farm-support/http.mjs';
import { randomBytes } from 'node:crypto';
import { projectConfig } from '../src/farm-support/project-config.js';

// A real authenticator decodes the URI's Base32 secret. The library's server-only
// generator expects raw secret bytes/text, not that encoded presentation value.
const authRequire = createRequire(import.meta.resolve('better-auth'));
const { base32 } = await import(pathToFileURL(authRequire.resolve('@better-auth/utils/base32')));

async function fixture(t) {
  const f = await identityFixture(t), admin = await f.account('mfa-admin@example.test', 'admin', undefined, { projectAdmin: true });
  const app = await startProductionServer({ store: f.store, config: f.config, clientDir: temporaryClient(t) });
  t.after(() => app.close());
  function client(initial = '') {
    const jar = new Map(initial.split('; ').filter(Boolean).map(v => { const n = v.indexOf('='); return [v.slice(0, n), v.slice(n + 1)]; }));
    const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    async function call(path, data) {
      return new Promise((ok, bad) => {
        const req = request({ hostname: '127.0.0.1', port: app.port, path: '/api/farm-support' + path, method: data === undefined ? 'GET' : 'POST', headers: { host: new URL(f.config.origin).host, origin: f.config.origin, 'content-type': 'application/json', cookie: cookie() } }, res => {
          for (const raw of res.headers['set-cookie'] || []) { const pair = raw.split(';')[0], n = pair.indexOf('='), name = pair.slice(0, n), value = pair.slice(n + 1); if (value) jar.set(name, value); else jar.delete(name); }
          const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); ok({ status: res.statusCode, body: JSON.parse(text) }); }); res.on('error', bad);
        });
        req.on('error', bad); req.end(data === undefined ? undefined : JSON.stringify(data));
      });
    }
    return { cookie, call };
  }
  const code = async secret => (await app.auth.api.generateTOTP({ body: { secret: new TextDecoder().decode(base32.decode(secret)) } })).code;
  async function enroll(c) {
    assert.equal((await c.call('/auth/sign-in/email', { email: 'mfa-admin@example.test', password: testPassword })).status, 200);
    const enabled = await c.call('/auth/two-factor/enable', { password: testPassword });
    assert.equal(enabled.status, 200, 'administrator must be able to start verified TOTP enrollment');
    assert.equal(new URL(enabled.body.totpURI).searchParams.get('issuer'), projectConfig.projectNameEn, 'authenticator must identify this independent project');
    const secret = new URL(enabled.body.totpURI).searchParams.get('secret');
    assert.equal((await c.call('/workspace')).status, 403);
    assert.equal((await c.call('/auth/two-factor/verify-totp', { code: await code(secret), trustDevice: true })).status, 200);
    return { secret, backups: enabled.body.backupCodes };
  }
  return { ...f, app, admin, client, code, enroll };
}
test('admin enrollment gates direct business APIs and proof applies only to the verified session', async t => {
  const f = await fixture(t), prior = f.client(), current = f.client();
  await prior.call('/auth/sign-in/email', { email: 'mfa-admin@example.test', password: testPassword });
  assert.equal((await prior.call('/account/status')).body.status, 'MFA_SETUP_REQUIRED');
  for (const [path, input] of [['/workspace'], ['/contact?type=person&id=unknown'], ['/print?id=unknown'], ['/invitation', {}], ['/command', {}]]) assert.equal((await prior.call(path, input)).status, 403);
  await f.enroll(current);
  assert.equal((await current.call('/workspace')).status, 200);
  assert.equal((await current.call('/account/status')).body.status, 'APPROVED');
  assert.equal((await prior.call('/workspace')).status, 403, 'enrollment on another session cannot authorize an old password-only session');
  for (const path of ['/auth/two-factor/disable', '/auth/two-factor/view-backup-codes', '/auth/admin/update-user', '/auth/reset-password']) assert.equal((await current.call(path, {})).status, 404);
});
test('new sign-ins require factor, reject wrong/reused challenge and do not establish trusted-device bypass', async t => {
  const f = await fixture(t), original = f.client(), { secret } = await f.enroll(original), login = f.client();
  const first = await login.call('/auth/sign-in/email', { email: 'mfa-admin@example.test', password: testPassword, mfaVerified: true });
  assert.equal(first.body.twoFactorRedirect, true); assert.equal((await login.call('/workspace')).status, 401);
  const challengeCookie = login.cookie();
  assert.equal((await login.call('/auth/two-factor/verify-totp', { code: 'invalid' })).status, 401);
  assert.equal((await login.call('/auth/two-factor/verify-totp', { code: await f.code(secret), trustDevice: true })).status, 200);
  assert.equal((await login.call('/workspace')).status, 200);
  const replay = f.client(challengeCookie);
  assert.equal((await replay.call('/auth/two-factor/verify-totp', { code: await f.code(secret) })).status, 401);
  await login.call('/auth/sign-out', {});
  assert.equal((await login.call('/auth/sign-in/email', { email: 'mfa-admin@example.test', password: testPassword })).body.twoFactorRedirect, true);
});
test('backup codes are single-use and permission revocation invalidates a verified session', async t => {
  const f = await fixture(t), original = f.client(), { backups } = await f.enroll(original), recovery = f.client();
  await recovery.call('/auth/sign-in/email', { email: 'mfa-admin@example.test', password: testPassword });
  assert.equal((await recovery.call('/auth/two-factor/verify-backup-code', { code: backups[0] })).status, 200);
  assert.equal((await recovery.call('/workspace')).status, 200);
  const second = f.client(); await second.call('/auth/sign-in/email', { email: 'mfa-admin@example.test', password: testPassword });
  assert.equal((await second.call('/auth/two-factor/verify-backup-code', { code: backups[0] })).status, 401);
  f.store.transact(s => { s.grants.find(g => g.userId === f.admin).active = false; });
  assert.equal((await recovery.call('/workspace')).status, 401);
  assert.equal((await recovery.call('/auth/two-factor/enable', { password: testPassword })).status, 403);
});
test('backup exports require current global administrator MFA and private download authorization', async t => {
  const f = await fixture(t), client = f.client();
  assert.equal((await client.call('/backup/download?part=receipt')).status, 401);
  await client.call('/auth/sign-in/email', { email: 'mfa-admin@example.test', password: testPassword });
  assert.equal((await client.call('/backup', { backupKeyBase64: randomBytes(32).toString('base64') })).status, 403);
  await f.enroll(client);
  const key = randomBytes(32).toString('base64');
  const exported = await client.call('/backup', { backupKeyBase64: key });
  assert.equal(exported.status, 201); assert.match(exported.body.checkpointId, /^[a-f0-9-]{36}$/);
  assert.equal(JSON.stringify(exported.body).includes(key), false);
  const receipt = await client.call('/backup/download?part=receipt');
  assert.equal(receipt.status, 200); assert.equal(receipt.body.checkpointId, exported.body.checkpointId);
  assert.equal((await client.call('/backup/download?part=../../instance.json')).status, 400);
  assert.equal((await client.call('/backup', { backupKeyBase64: key })).status, 409);
  f.store.transact(s => { s.grants.find(g => g.userId === f.admin).projectAdmin = false; });
  assert.equal((await client.call('/backup/download?part=receipt')).status, 403);
});

test('MFA limits use the verified account, not cookie order, added cookies or another session', async t => {
  const f = await fixture(t), first = f.client(), anotherSession = f.client();
  for (const c of [first, anotherSession]) await c.call('/auth/sign-in/email', { email: 'mfa-admin@example.test', password: testPassword });
  for (let i = 0; i < 10; i++) assert.equal((await first.call('/auth/two-factor/verify-totp', { code: 'invalid' })).status, 401);
  assert.equal((await first.call('/auth/two-factor/verify-totp', { code: 'invalid' })).status, 429);
  for (const cookie of [first.cookie() + '; harmless=one', ['harmless=two', ...first.cookie().split('; ').reverse()].join('; '), anotherSession.cookie()]) {
    assert.equal((await f.client(cookie).call('/auth/two-factor/verify-totp', { code: 'invalid' })).status, 429);
  }
  await f.account('other-mfa@example.test');
  const other = f.client(); await other.call('/auth/sign-in/email', { email: 'other-mfa@example.test', password: testPassword });
  assert.equal((await other.call('/auth/two-factor/verify-totp', { code: 'invalid' })).status, 401, 'another verified account keeps its own allowance');
});

test('a fresh signed MFA challenge does not reset the account limit', async t => {
  const f = await fixture(t), original = f.client(), { backups } = await f.enroll(original);
  const challenges = [f.client(), f.client()];
  for (const c of challenges) {
    assert.equal((await c.call('/auth/sign-in/email', { email: 'mfa-admin@example.test', password: testPassword })).body.twoFactorRedirect, true);
    for (let i = 0; i < 4; i++) assert.equal((await c.call('/auth/two-factor/verify-backup-code', { code: 'invalid' })).status, 401);
  }
  const fresh = f.client(); await fresh.call('/auth/sign-in/email', { email: 'mfa-admin@example.test', password: testPassword });
  assert.equal((await f.client('noise=one; ' + fresh.cookie()).call('/auth/two-factor/verify-backup-code', { code: backups[0] })).status, 429);
});

test('unverified or forged challenge cookies cannot choose an account rate-limit bucket', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 12; i++) {
    const forged = f.client(`__Secure-better-auth.two_factor=${f.admin}; userId=${f.admin}`);
    assert.equal((await forged.call('/auth/two-factor/verify-totp', { code: 'invalid' })).status, 401);
  }
  const legitimate = f.client(); await legitimate.call('/auth/sign-in/email', { email: 'mfa-admin@example.test', password: testPassword });
  assert.equal((await legitimate.call('/auth/two-factor/verify-totp', { code: 'invalid' })).status, 401);
});
