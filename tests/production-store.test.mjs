import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, renameSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { villageIds } from './fixture-villages.mjs';

async function modules() {
  const config = await import('../server/farm-support/config.mjs').catch(() => ({}));
  const storage = await import('../server/farm-support/production-store.mjs').catch(() => ({}));
  assert.equal(typeof config.readProductionConfig, 'function', 'validated production config must exist');
  assert.equal(typeof storage.provisionStorage, 'function', 'explicit provision must exist');
  return { ...config, ...storage };
}
const environment = () => ({ NODE_ENV: 'production', FARM_ORIGIN: 'https://farm.example.test', PORT: '10000', FARM_DATA_DIR: '/var/data/farm-support', FARM_AUTH_SECRET: randomBytes(48).toString('hex'), FARM_DATA_KEY_BASE64: randomBytes(32).toString('base64'), FARM_INSTANCE_ID: 'fixture-unique-instance' });
function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'farm-production-test-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function bytes(dir) {
  return Object.fromEntries(readdirSync(dir).sort().map(name => [name, createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')]));
}
async function fixture(t) {
  const api = await modules(), dataDir = directory(t);
  const config = { ...api.readProductionConfig(environment()), dataDir };
  return { ...api, config };
}

test('production config validates origin, keys, port, instance and exact persistent path', async () => {
  const { readProductionConfig } = await modules(), env = environment();
  const config = readProductionConfig(env);
  assert.equal(config.origin, env.FARM_ORIGIN);
  assert.equal(config.mainSiteOrigin, null);
  assert.equal(config.dataKey.length, 32);
  for (const [field, value] of [
    ['NODE_ENV', 'development'], ['FARM_ORIGIN', 'http://farm.example.test'], ['FARM_ORIGIN', 'https://farm.example.test/path'],
    ['FARM_ORIGIN', 'https://user:password@farm.example.test'], ['FARM_ORIGIN', 'https://farm.example.test?x=1'],
    ['PORT', '0'], ['PORT', '65536'], ['PORT', '10junk'], ['FARM_DATA_DIR', './runtime'],
    ['FARM_AUTH_SECRET', 'short'], ['FARM_DATA_KEY_BASE64', 'unparseable'], ['FARM_DATA_KEY_BASE64', randomBytes(31).toString('base64')],
    ['FARM_INSTANCE_ID', ''], ['FARM_INSTANCE_ID', '../elsewhere'],
  ]) assert.throws(() => readProductionConfig({ ...env, [field]: value }), /CONFIG_/);
  for (const field of Object.keys(env)) assert.throws(() => readProductionConfig({ ...env, [field]: undefined }), /CONFIG_/);
});

test('Linux mount validation requires the exact mount point and ignores environment-style substitutes', async () => {
  const { isPersistentMount } = await modules();
  assert.equal(typeof isPersistentMount, 'function');
  assert.equal(isPersistentMount('21 1 8:1 / /var/data/farm-support rw - ext4 /dev/sda rw\n'), true);
  assert.equal(isPersistentMount('21 1 8:1 / / rw - ext4 /dev/sda rw\n'), false);
  assert.equal(isPersistentMount('21 1 8:1 / /var/data/farm-support-other rw - ext4 /dev/sda rw\n'), false);
});

test('missing mount or missing storage refuses startup without creating anything', async t => {
  const f = await fixture(t);
  await assert.rejects(() => f.provisionStorage(f.config, { verifiedMount: false }), /MOUNT_REQUIRED/);
  assert.throws(() => f.openProductionStore(f.config, { verifiedMount: false }), /MOUNT_REQUIRED/);
  assert.throws(() => f.openProductionStore(f.config, { verifiedMount: true }), /STORAGE_MISSING/);
  assert.deepEqual(readdirSync(f.config.dataDir), []);
});

test('explicit first provision is empty PREPARING and normal reopen preserves records', async t => {
  const f = await fixture(t);
  await f.provisionStorage(f.config, { verifiedMount: true });
  let store = f.openProductionStore(f.config, { verifiedMount: true });
  const state = store.read();
  assert.equal(state.environment, 'production'); assert.equal(state.program, 'PREPARING');
  assert.deepEqual(state.villages.map(v => v.id), villageIds); assert.ok(state.villages.every(v => v.state === 'PREPARING'));
  for (const key of ['grants', 'people', 'requests', 'orders', 'invitations']) assert.deepEqual(state[key], []);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM user').get().n, 0);
  store.transact(s => { s.audit.push({ command: 'synthetic-test-only' }); });
  store.db.close();
  store = f.openProductionStore(f.config, { verifiedMount: true });
  assert.equal(store.read().audit[0].command, 'synthetic-test-only'); store.db.close();
  const before = bytes(f.config.dataDir);
  await assert.rejects(() => f.provisionStorage(f.config, { verifiedMount: true }), /ALREADY_INITIALIZED|PARTIAL/);
  assert.deepEqual(bytes(f.config.dataDir), before);
});

test('wrong key, auth secret or instance cannot alter database, journal or marker bytes', async t => {
  const f = await fixture(t); await f.provisionStorage(f.config, { verifiedMount: true });
  const before = bytes(f.config.dataDir);
  for (const changed of [{ dataKey: randomBytes(32) }, { authSecret: randomBytes(48).toString('hex') }, { instanceId: 'different-instance' }]) {
    assert.throws(() => f.openProductionStore({ ...f.config, ...changed }, { verifiedMount: true }), /STORAGE_IDENTITY/);
    assert.deepEqual(bytes(f.config.dataDir), before);
  }
});

test('missing required files and unsupported marker schema fail without recreating or migrating', async t => {
  const f = await fixture(t); await f.provisionStorage(f.config, { verifiedMount: true });
  for (const name of ['farm.sqlite', 'privacy.log', 'instance.json']) {
    const path = join(f.config.dataDir, name), hidden = join(f.config.dataDir, `${name}.held`);
    renameSync(path, hidden);
    const before = bytes(f.config.dataDir);
    assert.throws(() => f.openProductionStore(f.config, { verifiedMount: true }), /STORAGE_MISSING/);
    assert.deepEqual(bytes(f.config.dataDir), before); renameSync(hidden, path);
  }
  const marker = join(f.config.dataDir, 'instance.json'), data = JSON.parse(readFileSync(marker, 'utf8'));
  data.schema = 999; writeFileSync(marker, JSON.stringify(data));
  const before = bytes(f.config.dataDir);
  assert.throws(() => f.openProductionStore(f.config, { verifiedMount: true }), /SCHEMA|IDENTITY/);
  assert.deepEqual(bytes(f.config.dataDir), before);
});

test('partial provisioning and symlinked storage are refused, not reset', async t => {
  const f = await fixture(t); writeFileSync(join(f.config.dataDir, '.provisioning'), 'synthetic partial marker');
  const before = bytes(f.config.dataDir);
  await assert.rejects(() => f.provisionStorage(f.config, { verifiedMount: true }), /PARTIAL/);
  assert.deepEqual(bytes(f.config.dataDir), before);
  const parent = directory(t), outside = directory(t), link = join(parent, 'mount');
  symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => f.provisionStorage({ ...f.config, dataDir: link }, { verifiedMount: true }), /SYMLINK/);
  assert.deepEqual(readdirSync(outside), []);
});
