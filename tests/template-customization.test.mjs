import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('non-default one-, two- and three-village configurations initialize, invite, scope and revoke independently', () => {
  for (const count of [2, 3, 1]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./custom-config-scenario.mjs', import.meta.url)), String(count)], { encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { configuredVillages: count, initialized: true, invitationActivated: true, revoked: true });
  }
});
