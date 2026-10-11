import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

test('normal production entry fails safely without configured production identity', () => {
  const result = spawnSync(process.execPath, ['scripts/farm-support/production.mjs'], { env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^Startup refused: CONFIG_ENVIRONMENT\s*$/);
});
test('provisioning requires an explicit --start and cannot expose environment secrets', () => {
  const secret = randomBytes(48).toString('hex');
  const result = spawnSync(process.execPath, ['scripts/farm-support/provision.mjs'], { env: { ...process.env, FARM_AUTH_SECRET: secret }, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PROVISION_REQUIRES_START/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
});
test('normal entry never runs migrations or demo bootstrapping and uses actual mount information', () => {
  const runtime = readFileSync('scripts/farm-support/runtime.mjs', 'utf8');
  assert.match(runtime, /\/proc\/self\/mountinfo/);
  assert.doesNotMatch(runtime, /farm-support\/local|createDemoMailer|process\.env\.(?:VERIFIED_MOUNT|SKIP_MOUNT)/);
  const normal = readFileSync('scripts/farm-support/production.mjs', 'utf8');
  assert.match(normal, /startRuntime\(\)/);
  assert.doesNotMatch(normal, /provision:\s*true/);
});
