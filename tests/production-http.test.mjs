import { villageA } from './fixture-villages.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, copyFileSync } from 'node:fs';
import { resourceCatalog } from '../src/farm-support/resource-catalog.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { provisionStorage, openProductionStore } from '../server/farm-support/production-store.mjs';
import { temporaryClient } from './static-fixture.mjs';
import { projectConfig } from '../src/farm-support/project-config.js';

async function fixture(t) {
  const module = await import('../server/farm-support/http.mjs');
  assert.equal(typeof module.startProductionServer, 'function', 'production server must exist separately from local guard');
  const dataDir = mkdtempSync(join(tmpdir(), 'farm-production-http-'));
  const config = { origin: 'https://farm.example.test', port: 0, dataDir, authSecret: randomBytes(48).toString('hex'), dataKey: randomBytes(32), instanceId: 'http-fixture-instance', mainSiteOrigin: null };
  await provisionStorage(config, { verifiedMount: true });
  const store = openProductionStore(config, { verifiedMount: true }), clientDir = temporaryClient(t);
  const app = await module.startProductionServer({ store, config, clientDir });
  t.after(async () => { await app.close(); store.db.close(); rmSync(dataDir, { recursive: true, force: true }); });
  // The local HTTP transport emulates the TLS-terminating host's exact Host header.
  // Node fetch intentionally replaces custom Host; do not weaken server validation.
  const get = (path, options = {}) => new Promise((ok, bad) => {
    const req = request({ hostname: '127.0.0.1', port: app.port, path, method: options.method || 'GET', headers: { host: 'farm.example.test', ...options.headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8'), headers = new Headers();
        for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
        ok({ status: res.statusCode, headers, text: async () => text, json: async () => JSON.parse(text) });
      }); res.on('error', bad);
    });
    req.on('error', bad); req.end(options.body);
  });
  const post = (path, input, headers = {}) => get(`/api/farm-support${path}`, { method: 'POST', headers: { origin: config.origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(input) });
  return { app, store, config, get, post, clientDir, dataDir };
}
test('production public endpoints disclose no identity or data and disabled registration remains closed', async t => {
  const f = await fixture(t);
  assert.deepEqual(await (await f.get('/healthz')).json(), { status: 'ready' });
  assert.deepEqual(await (await f.get('/api/farm-support/config')).json(), { environment: 'production', mainSiteOrigin: f.config.mainSiteOrigin, registrationEnabled: false, project: projectConfig });
  for (const path of ['/registration/request', '/registration/complete', '/auth/sign-up/email', '/auth/admin/create-user']) assert.equal((await f.post(path, {})).status, 404);
  assert.equal((await f.get('/api/farm-support/registration/demo-mail')).status, 404);
  assert.equal((await f.get('/api/farm-support/workspace')).status, 401);
  const page = await f.get('/farm-support/manage/');
  assert.equal(page.status, 200); assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(page.headers.get('x-robots-tag'), /noindex/); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(page.headers.get('permissions-policy'), 'geolocation=(), camera=(), microphone=()');
  assert.equal(page.headers.get('access-control-allow-origin'), null);
  for (const route of ['/zh/tools/','/en/tools/']) assert.equal((await f.get(route)).status,200);
  mkdirSync(join(f.clientDir,'network-tools'));
  for (const row of resourceCatalog) {
    const relative = row.path.replace('public/',''); copyFileSync(row.path,join(f.clientDir,relative));
    const download=await f.get('/'+relative,{method:'HEAD'});
    assert.equal(download.status,200); assert.equal(download.headers.get('content-length'),String(row.bytes));
    assert.equal(download.headers.get('x-content-type-options'),'nosniff'); assert.match(download.headers.get('content-disposition'),/attachment/);assert.equal(await download.text(),'');
  }
  assert.equal((await f.get('/network-tools/unknown.docx')).status,404);
  assert.equal((await f.get('/api/farm-support/workspace')).status,401);
});
test('production login sets secure private cookies while privilege stays gated and failed logins are generic', async t => {
  const f = await fixture(t), password = 'Fictional-Production-Test-Only!';
  const created = await f.app.auth.api.createUser({ body: { email: 'coordinator@example.test', name: '虚构负责人', password } });
  f.store.transact(s => s.grants.push({ userId: created.user.id, role: 'coordinator', villages: [villageA], active: true }));
  const response = await f.post('/auth/sign-in/email', { email: 'coordinator@example.test', password });
  assert.equal(response.status, 200);
  const cookies = response.headers.getSetCookie(); assert.ok(cookies.length);
  assert.ok(cookies.some(v => /Secure/i.test(v) && /HttpOnly/i.test(v) && /SameSite=Lax/i.test(v)));
  const cookie = cookies.map(v => v.split(';')[0]).join('; ');
  const data = await f.get('/api/farm-support/workspace', { headers: { cookie } }); assert.equal(data.status, 200); assert.equal((await data.json()).villages.length, 1);
  f.store.transact(s => { s.grants[0].role = 'admin'; });
  assert.equal((await f.get('/api/farm-support/workspace', { headers: { cookie } })).status, 403);
  const wrong = await f.post('/auth/sign-in/email', { email: 'coordinator@example.test', password: 'not-valid' });
  const unknown = await f.post('/auth/sign-in/email', { email: 'unknown@example.test', password: 'not-valid' });
  assert.equal(wrong.status, unknown.status); assert.deepEqual(await wrong.json(), await unknown.json());
});
test('production rejects cross-origin/host, unsafe methods, malformed and oversized JSON', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('/auth/sign-in/email', {}, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.get('/healthz', { headers: { host: 'evil.example', 'x-forwarded-host': 'farm.example.test' } })).status, 403);
  assert.equal((await f.get('/api/farm-support/command', { method: 'PUT' })).status, 405);
  assert.equal((await f.get('/api/farm-support/command')).status, 404);
  const bad = await f.get('/api/farm-support/auth/sign-in/email', { method: 'POST', headers: { origin: f.config.origin, 'content-type': 'application/json' }, body: '{' });
  assert.equal(bad.status, 400);
  assert.equal((await f.post('/auth/sign-in/email', { password: 'x'.repeat(33000) })).status, 413);
});
test('static serving refuses private files, encoded traversal and symlinks; HEAD has no body', async t => {
  const f = await fixture(t); mkdirSync(join(f.clientDir, 'assets'));
  writeFileSync(join(f.clientDir, '.env'), 'fictional');
  writeFileSync(join(f.clientDir, 'assets', 'safe.js'), 'export const value = 1');
  symlinkSync(f.dataDir, join(f.clientDir, 'assets', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const path of ['/.env', '/farm.sqlite', '/server/farm-support/http.mjs', '/assets/escape/instance.json', '/assets/%2e%2e%2f.env', '/unknown/']) assert.equal((await f.get(path)).status, 404, path);
  assert.equal((await f.get('/assets/safe.js')).status, 200);
  for (const path of ['/farm-support/manage/', '/assets/safe.js', '/healthz']) assert.equal(await (await f.get(path, { method: 'HEAD' })).text(), '');
});
