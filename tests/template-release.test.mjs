import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as release from '../scripts/check-release.mjs';

function tree(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'network-release-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content);
  }
  return root;
}
test('release permits the precise license, project config and blank template set, but no extra template or config', t => {
  const root = tree(t, { LICENSE: 'MIT License', 'THIRD_PARTY_NOTICES.md': 'Third party notices', 'README.en.md': 'Overview', 'SECURITY.md': 'Security', 'CONTRIBUTING.md': 'Contributing', '.gitattributes': '* text=auto eol=lf\n', 'config/project.json': '{}', 'templates/people.csv': 'name,phone,villages,skills,consent,verified,pattern_days,pattern_start,pattern_end\n', 'templates/availability.csv': 'id,version,start,end,evidence,consent\n', 'templates/requests.csv': 'village,household,name,phone,task,note,source,actualAt,consent\n', 'templates/examples/person-create.json': '{}', 'templates/examples/request-create.json': '{}', 'templates/examples/matches.json': '{}' });
  assert.deepEqual(release.inspectRelease({ root }), { ok: true, violations: [] });
  for (const path of ['config/people.json', 'templates/private.json', 'templates/extra.csv']) {
    const invalid = tree(t, { [path]: '{}' }); assert.equal(release.inspectRelease({ root: invalid }).ok, false);
  }
});

test('release and history refuse commented credentials and populated or altered CSVs without disclosing values', async t => {
  const { createSourceManifest } = await import('../scripts/source-manifest.mjs');
  const fictional = 'ghp_' + 'A'.repeat(32);
  assert.equal(release.inspectRelease({ root: tree(t, { '.env.example': `# ${fictional}\nFARM_AUTH_SECRET=\n` }) }).ok, false);
  const headers = {
    'templates/people.csv': 'name,phone,villages,skills,consent,verified,pattern_days,pattern_start,pattern_end',
    'templates/availability.csv': 'id,version,start,end,evidence,consent',
    'templates/requests.csv': 'village,household,name,phone,task,note,source,actualAt,consent',
  };
  const bad = { '.env.example': `# Fictional ${fictional}\nFARM_AUTH_SECRET=\n` };
  for (const [path, header] of Object.entries(headers)) {
    assert.equal(release.inspectRelease({ root: tree(t, { [path]: header + '\r\n' }) }).ok, true);
    for (const content of [header + '\nFictional,000-DEMO-ONLY\n', header + ',unexpected\n']) {
      const root = tree(t, { [path]: content });
      assert.equal(release.inspectRelease({ root }).ok, false, path);
      assert.throws(() => createSourceManifest(root), /RELEASE_INPUT_DENIED/);
    }
    bad[path] = header + '\nFictional,000-DEMO-ONLY\n';
  }
  for (const [path, content] of Object.entries(bad)) {
    const root = tree(t, { [path]: content });
    const checked = release.inspectRelease({ root });
    assert.equal(checked.ok, false, path);
    assert.ok(checked.violations.every(v => !v.includes(fictional) && !v.includes('000-DEMO-ONLY')));
    const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git(['init', '--initial-branch=main']); git(['add', '.']);
    const commit = () => git(['-c', 'user.name=Fictional', '-c', 'user.email=demo@example.test', 'commit', '-m', 'fixture only']);
    commit(); git(['rm', path]); writeFileSync(join(root, 'package.json'), '{}'); git(['add', '.']); commit();
    const history = release.inspectGitHistory(root);
    assert.equal(history.ok, false, path);
    assert.ok(history.violations.some(v => v.includes(path)));
    assert.ok(history.violations.every(v => !v.includes(fictional) && !v.includes('000-DEMO-ONLY')));
  }
});

test('incomplete shallow Git history fails closed even when the latest tree is clean', t => {
  const root = tree(t, { 'package.json': '{}' });
  const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git(['init', '--initial-branch=main']); git(['add', '.']);
  const commit = () => git(['-c', 'user.name=Fictional', '-c', 'user.email=demo@example.test', 'commit', '-m', 'fixture only']);
  commit(); writeFileSync(join(root, '.env'), 'FARM_AUTH_SECRET=FICTIONAL'); git(['add', '.']); commit(); git(['rm', '.env']); commit();
  const shallow = tree(t, {});
  execFileSync('git', ['clone', '--depth=1', '--no-local', pathToFileURL(root).href, shallow], { stdio: 'pipe' });
  assert.equal(release.inspectRelease({ root: shallow }).ok, true);
  const history = release.inspectGitHistory(shallow);
  assert.equal(history.ok, false);
  assert.ok(history.violations.some(v => v.includes('shallow')));
});
test('disguised JSON secrets, populated environment files, runtime and links are refused without echoing contents', t => {
  const fictional = 'NOT-A-REAL-SECRET-DO-NOT-DEPLOY';
  for (const [path, content] of Object.entries({ 'templates/examples/person-create.json': JSON.stringify({ backupKeyBase64: fictional }), '.env.example': `FARM_AUTH_SECRET=${fictional}`, '.runtime/state.json': fictional, 'server/private.sqlite': fictional })) {
    const result = release.inspectRelease({ root: tree(t, { [path]: content }) });
    assert.equal(result.ok, false, path); assert.ok(result.violations.every(v => !v.includes(fictional)));
  }
  const root = tree(t, { 'package.json': '{}' }); const outside = tree(t, { 'private.json': fictional });
  symlinkSync(outside, join(root, 'config'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(release.inspectRelease({ root }).ok, false);
});
test('built assets cannot connect to the original site, API or email or carry original research assets', t => {
  for (const marker of ['https://care-in-farming-seasons.com', 'https://care-in-farming-backend.onrender.com', 'careinfarming@163.com', '/project-assets/report.pdf']) {
    const root = tree(t, { 'package.json': '{}', 'dist/client/index.html': '<!doctype html>', 'dist/client/assets/app.js': `export const legacy=${JSON.stringify(marker)};` });
    assert.equal(release.inspectRelease({ root, artifactRoot: join(root, 'dist/client') }).ok, false, marker);
  }
});

test('unknown built tools cannot fall through the generic image asset allowance', t => {
  const root=tree(t,{'package.json':'{}','dist/client/index.html':'<!doctype html>','dist/client/network-tools/never-reviewed.png':Buffer.from('fictional image')});
  const result=release.inspectRelease({root,artifactRoot:join(root,'dist/client')});
  assert.equal(result.ok,false);assert.ok(result.violations.some(v=>v.includes('never-reviewed.png')));
});
test('manifest enumerates only accepted source, excludes itself and changes a digest when source changes', async t => {
  const module = await import('../scripts/source-manifest.mjs').catch(() => ({}));
  assert.equal(typeof module.createSourceManifest, 'function');
  const root = tree(t, { 'package.json': '{}\n', 'src/app.js': 'export const active=true;\n', 'docs/source-manifest.json': '{}', 'dist/client/index.html': 'ignored', 'node_modules/example.txt': 'ignored' });
  const first = module.createSourceManifest(root);
  assert.deepEqual(first.files.map(f => f.path), ['package.json', 'src/app.js']);
  assert.match(first.files[1].sha256, /^[a-f0-9]{64}$/);
  writeFileSync(join(root, 'src/app.js'), 'export const active=false;\n');
  assert.notEqual(module.createSourceManifest(root).files[1].sha256, first.files[1].sha256);
  writeFileSync(join(root, 'src/private.key'), 'fictional only');
  assert.throws(() => module.createSourceManifest(root), /RELEASE_INPUT_DENIED/);
});
test('Git history scan catches a deleted secret and reports paths, never secret values', t => {
  assert.equal(typeof release.inspectGitHistory, 'function');
  const root = tree(t, { 'package.json': '{}' });
  const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git(['init', '--initial-branch=main']); git(['add', '.']);
  const commit = () => git(['-c', 'user.name=Fictional', '-c', 'user.email=demo@example.test', 'commit', '-m', 'fixture only']); commit();
  assert.equal(release.inspectGitHistory(root).ok, true);
  writeFileSync(join(root, '.env'), 'FARM_AUTH_SECRET=NOT-A-REAL-SECRET'); git(['add', '.env']); commit();
  git(['rm', '.env']); commit();
  const result = release.inspectGitHistory(root);
  assert.equal(result.ok, false); assert.ok(result.violations.some(v => v.includes('.env')));
  assert.ok(result.violations.every(v => !v.includes('NOT-A-REAL-SECRET')));
});

test('release CLI completes manifest verification rather than deadlocking on its own module import', async t => {
  const root = tree(t, { 'package.json': '{}', 'docs/source-manifest.json': '{}', 'dist/client/index.html': '<!doctype html>' });
  const { createSourceManifest } = await import('../scripts/source-manifest.mjs');
  writeFileSync(join(root, 'docs/source-manifest.json'), JSON.stringify(createSourceManifest(root)));
  const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git(['init', '--initial-branch=main']); git(['add', 'package.json', 'docs/source-manifest.json']);
  git(['-c', 'user.name=Fictional', '-c', 'user.email=demo@example.test', 'commit', '-m', 'fixture only']);
  const command = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/check-release.mjs', import.meta.url))], { cwd: root, encoding: 'utf8', timeout: 20000 });
  assert.equal(command.status, 0, command.stderr);
  assert.match(command.stdout, /Release inventory passed/);
  writeFileSync(join(root, 'package.json'), '{"changed":true}');
  const stale = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/check-release.mjs', import.meta.url))], { cwd: root, encoding: 'utf8', timeout: 20000 });
  assert.equal(stale.status, 1); assert.match(stale.stderr, /inventory differs/);
});
