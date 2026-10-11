import test from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../src/farm-support/api.js';
const { loadClientConfig } = client;
import { createHash, randomBytes } from 'node:crypto';
import { openStore } from '../server/farm-support/store.mjs';
import { startFarmServer } from '../server/farm-support/http.mjs';
import configuredInput from '../config/project.json' with { type: 'json' };
const mod = await import('../src/farm-support/project-config.js').catch(() => ({}));
const input = () => ({ schemaVersion: 1, projectName: '测试 Network', projectNameEn: 'Test Network', contactEmail: null, mainSiteUrl: null, villages: [{ id: 'example-a', zh: '示例村甲', en: 'Example Village A' }, { id: 'example-b', zh: '示例村乙', en: 'Example Village B' }] });

test('shared project configuration accepts defaults and independent village IDs, freezes and normalizes optional links', () => {
  assert.equal(typeof mod.validateProjectConfig, 'function', 'shared validator must exist');
  const config = mod.validateProjectConfig(input());
  assert.ok(Object.isFrozen(config) && Object.isFrozen(config.villages) && Object.isFrozen(config.villages[0]));
  assert.deepEqual(mod.projectConfig.villages.map(v => v.id), configuredInput.villages.map(v => v.id));
  const custom = { ...input(), villages: ['north-1', 'west', 'east'].map(id => ({ id, zh: id, en: id })), contactEmail: '', mainSiteUrl: '' };
  assert.equal(mod.validateProjectConfig(custom).mainSiteUrl, null);
  assert.equal(mod.validateProjectConfig(custom).contactEmail, null);
  assert.ok(mod.sameProjectConfig(input(), { ...input(), contactEmail: '' }));
  assert.equal(mod.sameProjectConfig(input(), custom), false);
});

test('every later client interaction sends its compiled project fingerprint, and mismatches invalidate private views', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const expected = createHash('sha256').update(JSON.stringify(mod.projectConfig)).digest('hex');
  let calls = 0, boundaries = 0;
  assert.equal(typeof client.onConfigurationMismatch, 'function');
  const unsubscribe = client.onConfigurationMismatch(error => { assert.equal(error.code, 'CONFIG_MISMATCH'); boundaries++; }); t.after(unsubscribe);
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers['x-farm-project-version'], expected);
    calls++;
    return calls === 1 ? Response.json({ actor: { id: 'fictional' } }) : Response.json({ error: 'CONFIG_MISMATCH' }, { status: 409 });
  };
  await client.requestApi('/workspace');
  for (const [path, data] of [['/workspace'], ['/command', { key: 'fictional-only' }], ['/contact?type=person&id=fictional'], ['/auth/sign-in/email', { email: 'demo@example.test' }]]) {
    await assert.rejects(client.requestApi(path, data), error => error.code === 'CONFIG_MISMATCH');
  }
  assert.equal(boundaries, 4);
  let matchBoundaries = 0;
  await assert.rejects(client.requestMatches({}, () => true, () => matchBoundaries++), e => e.code === 'CONFIG_MISMATCH');
  assert.equal(matchBoundaries, 1);
});

test('server rejects mismatched compiled clients before any private read, login, invitation or command; logout remains available', async t => {
  const store = openStore(':memory:', randomBytes(32));
  const runtime = await startFarmServer({ store, secret: randomBytes(48).toString('hex'), port: 0 });
  t.after(async () => { await runtime.close(); store.db.close(); });
  const { origin } = runtime, state = store.read();
  for (const [path, method] of [['/workspace', 'GET'], ['/contact?type=person&id=fictional', 'GET'], ['/command', 'POST'], ['/invitation', 'POST'], ['/auth/sign-in/email', 'POST']]) {
    const response = await fetch(origin + '/api/farm-support' + path, { method, headers: { origin, 'content-type': 'application/json', 'x-farm-project-version': '0'.repeat(64) }, ...(method === 'POST' ? { body: '{}' } : {}) });
    assert.equal(response.status, 409, path); assert.equal((await response.json()).error, 'CONFIG_MISMATCH');
  }
  assert.deepEqual(store.read(), state);
  const config = await fetch(origin + '/api/farm-support/config', { headers: { 'x-farm-project-version': '0'.repeat(64) } });
  assert.equal(config.status, 200);
  const logout = await fetch(origin + '/api/farm-support/auth/sign-out', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-farm-project-version': '0'.repeat(64) }, body: '{}' });
  assert.notEqual(logout.status, 409);
});

test('configuration rejects unsafe fields, invalid IDs, text and link destinations', () => {
  assert.equal(typeof mod.validateProjectConfig, 'function');
  const bad = [null, [], { ...input(), extra: 1 }, { ...input(), schemaVersion: 2 }, { ...input(), villages: [] }, { ...input(), villages: [input().villages[0], input().villages[0]] }];
  for (const id of ['__proto__', 'constructor', 'prototype', 'X', 'a/b', 'a'.repeat(41)]) bad.push({ ...input(), villages: [{ id, zh: '甲', en: 'A' }] });
  for (const name of ['', 'a'.repeat(81), 'a\nB', '\u0085bad']) bad.push({ ...input(), projectName: name });
  for (const url of ['javascript:alert(1)', 'http://example.test', 'https://u:p@example.test/', 'https://example.test/path', 'https://example.test/?x=1', 'https://example.test/#x', 'https://example.test/\n']) bad.push({ ...input(), mainSiteUrl: url });
  for (const email of ['bad', 'a@b', 'a@example.test\n', 'a@example.test?']) bad.push({ ...input(), contactEmail: email });
  bad.push({ ...input(), villages: [{ id: 'new', zh: '甲', en: 'A', secret: true }] });
  for (const config of bad) assert.throws(() => mod.validateProjectConfig(config), /INVALID_PROJECT_CONFIG/);
  assert.equal(mod.sameProjectConfig(input(), null), false);
});

test('client refuses missing, unsafe and stale server project configuration before opening a workspace', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const config = { environment: 'production', registrationEnabled: false, mainSiteOrigin: null, project: mod.projectConfig };
  globalThis.fetch = async () => Response.json(config);
  assert.equal((await loadClientConfig()).environment, 'production');
  for (const project of [undefined, null, { ...input(), mainSiteUrl: 'javascript:alert(1)' }, input(), { ...mod.projectConfig, villages: [{ id: 'different', zh: '甲', en: 'A' }] }]) {
    globalThis.fetch = async () => Response.json({ ...config, project });
    await assert.rejects(loadClientConfig(), e => e.code === 'CONFIG_MISMATCH');
  }
});
