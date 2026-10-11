import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { identityFixture } from './identity-fixture.mjs';
import { createDomain } from '../server/farm-support/domain.mjs';
import * as api from '../src/farm-support/api.js';
import { projectConfig } from '../src/farm-support/project-config.js';
test('client configuration is server-read, same-origin and validates the fixed main-site destination', async t => {
  assert.equal(typeof api.loadClientConfig, 'function');
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/farm-support/config'); assert.equal(options.credentials, 'same-origin');
    return Response.json({ environment: 'production', mainSiteOrigin: null, registrationEnabled: false, project: projectConfig });
  };
  assert.equal((await api.loadClientConfig()).environment, 'production');
  globalThis.fetch = async () => Response.json({ environment: 'production', mainSiteOrigin: 'https://untrusted.example', registrationEnabled: true });
  await assert.rejects(api.loadClientConfig(), e => e.code === 'CONFIG_MISMATCH');
});
test('hosted login/activation have honest environment copy, owner contact, absolute main return and no public signup', async () => {
  const vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], logLevel: 'silent', server: { middlewareMode: true } });
  try {
    const mod = await vite.ssrLoadModule('/src/farm-support/LoginPanel.jsx').catch(() => ({}));
    assert.equal(typeof mod.default, 'function');
    for (const activation of [false, true]) {
      const html = renderToStaticMarkup(React.createElement(mod.default, { activation, config: { environment: 'production', registrationEnabled: false, mainSiteOrigin: null }, onSubmit() {} }));
      assert.doesNotMatch(html, /mailto:|care-in-farming-seasons/); assert.match(html, /本项目管理员/);
      assert.doesNotMatch(html, /本地|演示|farm-support\/register|邮件已发送/);
      assert.match(html, /maxLength="128"/); assert.match(html, /<label/);
    }
    const demo = renderToStaticMarkup(React.createElement(mod.default, { config: { environment: 'local-demo', registrationEnabled: false }, onSubmit() {} }));
    assert.match(demo, /本地演示/);
    const failedLogout = renderToStaticMarkup(React.createElement(mod.default, { config: { environment: 'production' }, logoutPending: true, onRetryLogout() {}, onSubmit() {} }));
    assert.match(failedLogout, /重试安全退出/);
    assert.match(failedLogout, /<button[^>]*disabled[^>]*>登录工作台/);
    const { default: PrintCard } = await vite.ssrLoadModule('/src/farm-support/PrintCard.jsx');
    const card = { terms: { start: Date.now(), end: Date.now(), task: 'sorting' }, confirmations: {}, generatedAt: Date.now() };
    const print = renderToStaticMarkup(React.createElement(PrintCard, { environment: 'production', card }));
    assert.doesNotMatch(print, /虚构|演示/);
    assert.match(print, /仅交给本单/);
  } finally { await vite.close(); }
});
test('production snapshots and summaries retain actual empty PREPARING state without demo/outcome claims', async t => {
  const f = await identityFixture(t), admin = await f.account('ui-owner@example.test'), domain = createDomain(f.store);
  const snapshot = domain.snapshot(admin);
  assert.equal(snapshot.environment, 'production'); assert.equal(snapshot.summary.environment, 'production');
  assert.equal(snapshot.program, 'PREPARING'); assert.equal(snapshot.summary.requests, 0);
  assert.doesNotMatch(snapshot.summary.label, /虚构|演示|健康改善/);
  assert.equal(domain.publicConfig().environment, 'production');
});
test('transport failure says result is unconfirmed, never asserts that a committed write was not saved', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => { throw Error('response lost'); };
  await assert.rejects(api.requestApi('/command', { key: 'same-on-retry' }), e => e.code === 'NETWORK_UNCONFIRMED');
  globalThis.fetch = async () => Response.json({ error: 'STORAGE_READ_ONLY' }, { status: 503 });
  await assert.rejects(api.requestApi('/command', {}), e => e.code === 'STORAGE_READ_ONLY');
});
