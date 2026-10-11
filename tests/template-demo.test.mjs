import { villageIds } from './fixture-villages.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { createServer } from 'node:http';
const mod = await import('../scripts/farm-support/demo.mjs').catch(() => ({}));

test('demo refuses production and reports only a non-sensitive failure', async t => {
  assert.equal(typeof mod.createDemoRuntime, 'function');
  const old = process.env.NODE_ENV; t.after(() => { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; });
  process.env.NODE_ENV = 'production';
  await assert.rejects(mod.createDemoRuntime({ port: 0 }), /DEMO_PRODUCTION_DENIED/);
});

test('demo has independent private storage, random credentials and no production configuration or public signup', async t => {
  assert.equal(typeof mod.createDemoRuntime, 'function');
  const old = process.env.FARM_DATA_DIR; t.after(() => { if (old === undefined) delete process.env.FARM_DATA_DIR; else process.env.FARM_DATA_DIR = old; });
  process.env.FARM_DATA_DIR = '/DO-NOT-READ-THIS-PRODUCTION-PATH';
  const a = await mod.createDemoRuntime({ port: 0 }), b = await mod.createDemoRuntime({ port: 0 });
  t.after(async () => { await a.close(); await b.close(); });
  assert.ok(a.origin.startsWith('http://127.0.0.1:'));
  assert.notEqual(dirname(a.accessFile), dirname(b.accessFile));
  const aa = JSON.parse(readFileSync(a.accessFile, 'utf8')), bb = JSON.parse(readFileSync(b.accessFile, 'utf8'));
  assert.equal(aa.email, 'demo@example.test'); assert.ok(aa.password.length >= 32);
  assert.notEqual(aa.password, bb.password);
  if (process.platform !== 'win32') assert.equal(statSync(a.accessFile).mode & 0o777, 0o600);
  const config = await (await fetch(a.origin + '/api/farm-support/config')).json();
  assert.equal(config.environment, 'local-demo'); assert.equal(config.registrationEnabled, false);
  assert.equal((await fetch(a.origin + '/api/farm-support/workspace')).status, 401);
  const login = await fetch(a.origin + '/api/farm-support/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json', origin: a.origin }, body: JSON.stringify({ email: aa.email, password: aa.password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  const workspace = await (await fetch(a.origin + '/api/farm-support/workspace', { headers: { cookie } })).json();
  assert.equal(workspace.program, 'PREPARING');
  assert.deepEqual(workspace.requests, []); assert.deepEqual(workspace.people, []);
  assert.deepEqual(workspace.actor.villages, villageIds);
  await a.close(); await a.close();
  await assert.rejects(fetch(a.origin + '/api/farm-support/config'));
});

test('demo occupied port fails clearly without affecting the listener', async t => {
  assert.equal(typeof mod.createDemoRuntime, 'function');
  const server = createServer((req, res) => res.end('unchanged'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(mod.createDemoRuntime({ port: server.address().port }), /DEMO_PORT_IN_USE/);
  assert.equal(await (await fetch(`http://127.0.0.1:${server.address().port}`)).text(), 'unchanged');
});
