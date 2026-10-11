import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('backup and restore commands require explicit authority before reading input', () => {
  for (const file of ['backup', 'restore']) {
    const child = spawnSync(process.execPath, ['scripts/farm-support/' + file + '.mjs'], { encoding: 'utf8', input: '{"private":"do-not-disclose"}' });
    assert.equal(child.status, 1); assert.match(child.stderr, /EXPLICIT_.*_OPERATION_REQUIRED/);
    assert.equal((child.stdout + child.stderr).includes('do-not-disclose'), false);
  }
});
test('synthetic backup/restore workload stays below 512 MiB RSS with a 256 MiB JS heap', () => {
  const child = spawnSync(process.execPath, ['--max-old-space-size=256', 'tests/maintenance-workload.mjs'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(child.status, 0, child.stderr);
  const output = JSON.parse(child.stdout.trim());
  assert.equal(output.restored, true); assert.ok(output.rssBytes < 512 * 1024 ** 2, JSON.stringify(output));
});
