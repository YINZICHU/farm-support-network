import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('release configuration pins Linux verification and never auto-deploys or seeds paid storage', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(ci, /runs-on: ubuntu-24\.04/);
  assert.match(ci, /node-version: ['"]24\.19\.0['"]/);
  assert.match(ci, /version: ['"]11\.19\.0['"]/);
  for (const script of ['pnpm install --frozen-lockfile', 'pnpm test', 'pnpm build', 'pnpm check:release', 'pnpm audit --prod']) assert.ok(ci.includes(script), script);
  assert.match(ci, /--memory=512m --memory-swap=512m/);
  assert.match(ci, /--max-old-space-size=256/);
  assert.match(ci, /permissions:\s*contents: read/);
  assert.doesNotMatch(ci, /pull_request_target|secrets\.|farm:local|provision\.mjs|render deploy|deploy-hook/i);
  const render = readFileSync(new URL('../render.yaml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal((render.match(/- type: web/g) || []).length, 1);
  for (const line of ['runtime: node', 'plan: 0.5c-512mb', 'region: singapore', 'numInstances: 1', 'autoDeployTrigger: off', 'healthCheckPath: /healthz', 'mountPath: /var/data/farm-support', 'sizeGB: 1', 'startCommand: node scripts/farm-support/production.mjs']) assert.ok(render.includes(line), line);
  assert.match(render, /buildCommand: pnpm install --frozen-lockfile --prod=false && pnpm build && pnpm check:release/);
  assert.doesNotMatch(render, /databases:|preDeployCommand:|provision\.mjs|seed|farm:local|scaling:/i);
  for (const name of ['FARM_ORIGIN', 'FARM_AUTH_SECRET', 'FARM_DATA_KEY_BASE64', 'FARM_INSTANCE_ID']) assert.ok(render.includes(`key: ${name}\n        sync: false`));
  const entry = readFileSync(new URL('../scripts/farm-support/production.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(entry, /loopbackOnly/);
});

async function inspector() {
  const module = await import('../scripts/check-release.mjs').catch(() => ({}));
  assert.equal(typeof module.inspectRelease, 'function', 'release inspection must exist before source upload');
  return module.inspectRelease;
}
function tree(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'farm-release-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

test('approved source and a names-only environment template pass inspection', async t => {
  const root = tree(t, { 'src/main.jsx': 'export const app = true;', 'package.json': '{"private":true}', '.env.example': 'FARM_AUTH_SECRET=\nFARM_DATA_KEY_BASE64=\n' });
  assert.deepEqual((await inspector())({ root }), { ok: true, violations: [] });
});
test('explicit backup command source is allowed but backup payloads and asset copies remain forbidden', async t => {
  const root = tree(t, { 'scripts/farm-support/backup.mjs': 'export const onlyCode = true;' });
  assert.equal((await inspector())({ root }).ok, true);
  for (const path of ['server/pending-backup.bundle.receipt.json', 'server/farm-recovery.receipt.json', 'scripts/farm-support/backup.sqlite']) {
    assert.equal((await inspector())({ root: tree(t, { [path]: '{}' }) }).ok, false);
  }
});

for (const path of ['.farm-support-runtime/private.sqlite', '.env', 'server/key.pem', 'backup.db-wal', 'public/project-assets/report.docx', 'src/secrets.key', 'src/app.js.map']) {
  test(`release refuses private or unrelated artifact ${path}`, async t => {
    const root = tree(t, { [path]: 'fictional test fixture only' });
    const result = (await inspector())({ root });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some(v => { const rejectedPath = v.split(': ')[0]; return path === rejectedPath || path.startsWith(`${rejectedPath}/`); }));
    assert.ok(result.violations.every(v => !v.includes('fictional test fixture only')));
  });
}

test('source scan rejects a populated environment template without printing its content', async t => {
  const root = tree(t, { '.env.example': 'FARM_AUTH_SECRET=fixture-not-a-real-secret\n' });
  const result = (await inspector())({ root });
  assert.equal(result.ok, false);
  assert.ok(result.violations.every(v => !v.includes('fixture-not-a-real-secret')));
});

test('built output may not contain a database or private key even when source is clean', async t => {
  const root = tree(t, { 'src/main.jsx': 'export const app = true;', 'dist/client/index.html': '<!doctype html>', 'dist/client/key.pem': 'fictional private key' });
  assert.equal((await inspector())({ root, artifactRoot: join(root, 'dist/client') }).ok, false);
});

test('symlinked source cannot pull an outside directory into the release', async t => {
  const outside = tree(t, { 'private.txt': 'fictional external material' });
  const root = tree(t, { 'package.json': '{"private":true}' });
  symlinkSync(outside, join(root, 'src'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await inspector())({ root }).ok, false);
});
