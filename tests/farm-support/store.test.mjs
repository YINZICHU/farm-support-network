import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openStore } from '../../server/farm-support/store.mjs';
import { villageIds } from '../fixture-villages.mjs';

test('business state survives reopen and does not expose contact plaintext in the database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'farm-store-')), path = join(dir, 'records.sqlite'), key = randomBytes(32);
  try {
    const first = openStore(path, key);
    first.transact(s => { s.people.push({ id: 'P01', phone: '13800001234', address: 'fictional private address' }); });
    first.db.close();
    assert.ok(!readFileSync(path).includes(Buffer.from('13800001234')));
    const second = openStore(path, key);
    assert.equal(second.read().people[0].phone, '13800001234');
    assert.deepEqual(second.read().villages.map(v => v.id), villageIds);
    assert.equal(second.read().villages[0].state, 'PREPARING');
    second.db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a failed transaction rolls back every write', () => {
  const store = openStore(':memory:', randomBytes(32));
  assert.throws(() => store.transact(s => { s.people.push({ id: 'oops' }); throw Error('conflict'); }), /conflict/);
  assert.equal(store.read().people.length, 0);
  store.db.close();
});

test('wrong encryption key fails closed rather than replacing records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'farm-key-')), path = join(dir, 'records.sqlite');
  const one = openStore(path, randomBytes(32)); one.db.close();
  try { assert.throws(() => openStore(path, randomBytes(32)), /authenticate|auth|decrypt/i); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
