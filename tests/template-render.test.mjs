import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { publicFallback } from '../src/farm-support/public-fallback.js';
const project = { schemaVersion: 1, projectName: '<img onerror="bad"> & Test', projectNameEn: 'Example Network', contactEmail: null, mainSiteUrl: null, villages: [{ id: 'custom', zh: '<img onerror="bad"> & 村', en: 'Example <Village>' }] };

test('document title follows configured identity and escapes markup without injecting a tag', async () => {
  const config = await import('../vite.config.mjs');
  assert.equal(typeof config.projectTitlePlugin, 'function');
  const vite = await createServer({ configFile: false, root: process.cwd(), plugins: [config.projectTitlePlugin(project)], logLevel: 'silent', server: { middlewareMode: true } });
  try {
    const html = await vite.transformIndexHtml('/', '<!doctype html><html><head><title>Previous project</title></head><body></body></html>');
    assert.match(html, /<title>负责人工作台 \| &lt;img onerror=&quot;bad&quot;&gt; &amp; Test<\/title>/);
    assert.doesNotMatch(html, /<img|Previous project/);
  } finally { await vite.close(); }
});

test('project identity hides absent links, escapes text and uses only configured root destinations', async () => {
  const vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], logLevel: 'silent', server: { middlewareMode: true } });
  try {
    const mod = await vite.ssrLoadModule('/src/farm-support/ProjectIdentity.jsx').catch(() => ({}));
    assert.equal(typeof mod.default, 'function', 'shared safe identity component must exist');
    const render = (kind, p = project) => renderToStaticMarkup(React.createElement(mod.default, { kind, project: p }));
    assert.equal(render('home'), '');
    assert.doesNotMatch(render('brand') + render('contact'), /<a|<img|care-in-farming-seasons|careinfarming/);
    assert.match(render('brand'), /&lt;img/);
    const configured = { ...project, mainSiteUrl: 'https://example.test', contactEmail: 'help@example.test' };
    assert.match(render('home', configured), /href="https:\/\/example.test"/);
    assert.match(render('contact', configured), /href="mailto:help@example.test"/);
  } finally { await vite.close(); }
});

test('contact links preserve the whole mailbox without turning local-part characters into URI headers', async () => {
  const vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], logLevel: 'silent', server: { middlewareMode: true } });
  try {
    const { default: Identity } = await vite.ssrLoadModule('/src/farm-support/ProjectIdentity.jsx');
    for (const mailbox of ['help?bcc=copy@example.test', 'help#copy@example.test', 'help%copy@example.test']) {
      const html = renderToStaticMarkup(React.createElement(Identity, { kind: 'contact', project: { ...project, contactEmail: mailbox } }));
      const uri = new URL(html.match(/href="([^"]+)"/)[1]);
      assert.equal(decodeURIComponent(uri.pathname), mailbox);
      assert.equal(uri.search, ''); assert.equal(uri.hash, '');
    }
  } finally { await vite.close(); }
});

test('configured title treats replacement metacharacters as literal project text', async () => {
  const { projectTitlePlugin } = await import('../vite.config.mjs');
  const vite = await createServer({ configFile: false, root: process.cwd(), plugins: [projectTitlePlugin({ ...project, projectName: "Cost $& $` $' Help" })], logLevel: 'silent', server: { middlewareMode: true } });
  try {
    const html = await vite.transformIndexHtml('/', '<html><head><title>Old</title></head><body></body></html>');
    assert.match(html, /<title>负责人工作台 \| Cost \$&amp; \$` \$&#39; Help<\/title>/);
    assert.equal((html.match(/<title>/g) || []).length, 1); assert.doesNotMatch(html, /Old/);
  } finally { await vite.close(); }
});

test('no-script village names are escaped and absent main website has no dead return link', () => {
  const html = publicFallback('zh', project);
  assert.match(html, /&lt;img onerror=&quot;bad&quot;&gt; &amp; 村/);
  assert.doesNotMatch(html, /<img|href="\/zh\/"|care-in-farming-seasons|careinfarming/);
  assert.match(publicFallback('en', project), /Example &lt;Village&gt;/);
});
