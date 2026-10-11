import { villageB } from '../fixture-villages.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../../server/farm-support/store.mjs';
import { fixture } from './helpers.mjs';

test('two genuinely concurrent database connections cannot reserve the same person', async () => {
  const f = fixture(), a = f.request(), b = f.request(villageB), key = randomBytes(32), dir = mkdtempSync(join(tmpdir(), 'farm-race-')), path = join(dir, 'race.sqlite');
  const store = openStore(path, key); store.transact(s => Object.assign(s, f.store.read())); f.store.db.close();
  const barrier = new SharedArrayBuffer(8), workers = [], results = [], ready = [];
  try {
    for (const r of [a, b]) {
      const w = new Worker(new URL('./race-worker.mjs', import.meta.url), { workerData: { path, key: key.toString('hex'), now: Date.parse('2026-10-12T00:00:00+08:00'), payload: f.terms(r), barrier } });
      workers.push(w); let resolveReady; ready.push(new Promise(ok => { resolveReady = ok; }));
      results.push(new Promise((ok, bad) => { w.on('message', m => m === 'ready' ? resolveReady() : ok(m)); w.on('error', bad); }));
    }
    await Promise.all(ready); Atomics.store(new Int32Array(barrier), 1, 1); Atomics.notify(new Int32Array(barrier), 1, 2);
    const outcomes = await Promise.all(results);
    assert.equal(outcomes.filter(x => x.ok).length, 1); assert.equal(outcomes.find(x => !x.ok).error, 'PERSON_CONFLICT');
    assert.equal(store.read().orders.length, 1); assert.equal(store.read().bookings.length, 2);
  } finally { await Promise.all(workers.map(w => w.terminate())); store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('consistent SQLite backup retains encrypted business records on reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'farm-backup-')), key = randomBytes(32), live = openStore(join(dir, 'live.sqlite'), key);
  try {
    live.transact(s => { s.people.push({ id: 'fictional', phone: '000-DEMO-ONLY' }); });
    await live.backup(join(dir, 'snapshot.sqlite'));
    const restored = openStore(join(dir, 'snapshot.sqlite'), key);
    assert.equal(restored.read().people[0].id, 'fictional'); assert.equal(restored.read().people[0].phone, '000-DEMO-ONLY');
    restored.db.close();
  } finally { live.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('concurrent village creators serialize a stale registry revision', async () => {
  const f = fixture(), key = randomBytes(32), dir = mkdtempSync(join(tmpdir(), 'network-village-race-')), path = join(dir, 'race.sqlite');
  const store = openStore(path, key); store.transact(s => Object.assign(s, f.store.read())); f.store.db.close();
  const barrier = new SharedArrayBuffer(8), workers = [], results = [], ready = [];
  try {
    for (const i of [1, 2]) {
      const w = new Worker(new URL('./race-worker.mjs', import.meta.url), { workerData: { path, key: key.toString('hex'), now: Date.now(), command: 'village.create', payload: { zh: `虚构村${i}`, en: `Fictional Village ${i}`, evidence: 'Test authorization', registryRevision: 1 }, barrier } });
      workers.push(w); let resolveReady; ready.push(new Promise(ok => { resolveReady = ok; }));
      results.push(new Promise((ok, bad) => { w.on('message', m => m === 'ready' ? resolveReady() : ok(m)); w.on('error', bad); }));
    }
    await Promise.all(ready); Atomics.store(new Int32Array(barrier), 1, 1); Atomics.notify(new Int32Array(barrier), 1, 2);
    const outcomes = await Promise.all(results); assert.equal(outcomes.filter(x => x.ok).length, 1); assert.equal(outcomes.find(x => !x.ok).error, 'VERSION_CONFLICT');
    assert.equal(store.read().registryRevision, 2);
  } finally { await Promise.all(workers.map(w => w.terminate())); store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});
