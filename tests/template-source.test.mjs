import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { approvedResourceBytes, assertApprovedResource } from '../src/farm-support/resource-approval.js';

test('template export supplies its own reusable package identity and license', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.name, 'care-in-farming-toolkit');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.private, true);
  assert.ok(existsSync('LICENSE'), 'reuse grant must accompany template export');
  assert.ok(existsSync('THIRD_PARTY_NOTICES.md'), 'third-party rights must not be replaced');
});

test('template source never exports runtime, research or credential payload files', () => {
  const forbidden = /\.(?:sqlite(?:3)?(?:-.*)?|db(?:-.*)?|pem|key|docx?|xlsx?|pdf|rtf|log)$/i;
  const walk = (dir, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!prefix && ['.git', '.superpowers', 'node_modules', 'dist'].includes(entry.name)) continue;
      const path = prefix + entry.name;
      if (Object.hasOwn(approvedResourceBytes, path)) {
        assert.ok(entry.isFile()); assertApprovedResource(path, readFileSync(join(dir, entry.name))); continue;
      }
      assert.ok(!forbidden.test(path) && !(entry.name.startsWith('.env') && entry.name !== '.env.example'), `forbidden export path: ${path}`);
      if (entry.isDirectory()) walk(join(dir, entry.name), `${path}/`);
    }
  };
  walk(resolve('.'));
  assert.ok(readFileSync('.env.example', 'utf8').split(/\r?\n/).every(line => !line.trim() || line.startsWith('#') || /^[A-Z][A-Z0-9_]*=\s*$/.test(line)), 'environment example must contain names only');
});
