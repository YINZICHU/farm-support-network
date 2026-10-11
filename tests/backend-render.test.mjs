import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

async function render(path) {
  globalThis.window = { location: { pathname: path, hash: '' }, localStorage: { getItem: () => null }, addEventListener() {}, removeEventListener() {}, history: {} };
  const vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], logLevel: 'silent', server: { middlewareMode: true } });
  try {
    const module = await vite.ssrLoadModule('/src/BackendApp.jsx').catch(() => ({}));
    assert.equal(typeof module.BackendApp, 'function', 'standalone backend route shell must exist');
    return renderToStaticMarkup(React.createElement(module.BackendApp, { path }));
  } finally { await vite.close(); }
}

test('private backend routes start behind the authorization loading state', async () => {
  for (const path of ['/farm-support/manage/', '/farm-support/activate/']) {
    const html = await render(path);
    assert.match(html, /role="status"/);
    assert.doesNotMatch(html, /id="problem"|id="place-context"|13800001234/);
  }
});

test('unknown and public-registration routes do not expose account creation or village data', async () => {
  for (const path of ['/unknown/', '/farm-support/register/', '/en/farm-support/']) {
    const html = await render(path);
    assert.match(html, /农忙支援 Network/); assert.doesNotMatch(html, /care-in-farming-seasons.com|mailto:/);
    assert.doesNotMatch(html, /<form|type="password"|13800001234/);
  }
});
