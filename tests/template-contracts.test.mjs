import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { openStore } from '../server/farm-support/store.mjs';
import { createDomain } from '../server/farm-support/domain.mjs';
import { villageA } from './fixture-villages.mjs';
const json = file => { assert.ok(existsSync(file), 'missing template: ' + file); return JSON.parse(readFileSync(file, 'utf8')); };

test('offline CSV templates contain only the actual entry fields and no records', () => {
  const headers = {
    people: 'name,phone,villages,skills,consent,verified,pattern_days,pattern_start,pattern_end',
    availability: 'id,version,start,end,evidence,consent',
    requests: 'village,household,name,phone,task,note,source,actualAt,consent',
  };
  for (const [file, fields] of Object.entries(headers)) {
    const path = `templates/${file}.csv`; assert.ok(existsSync(path), 'missing blank template: ' + path);
    assert.deepEqual(readFileSync(path, 'utf8').trim().split(/\r?\n/), [fields]);
  }
});

test('fictional examples obey actual command, consent, version and matching contracts without automatic acceptance', () => {
  const person = json('templates/examples/person-create.json'), request = json('templates/examples/request-create.json'), matches = json('templates/examples/matches.json');
  assert.deepEqual(Object.keys(person).sort(), ['command', 'key', 'payload']);
  assert.equal(person.command, 'person.create'); assert.equal(request.command, 'request.create');
  assert.equal(person.payload.consent, false); assert.equal(person.payload.verified, false); assert.equal(request.payload.consent, false);
  assert.deepEqual(Object.keys(matches).sort(), ['end', 'request', 'start', 'version']);
  const store = openStore(':memory:', randomBytes(32));
  try {
    store.transact(s => { s.program = 'OPEN'; s.villages.forEach(v => { v.state = 'OPEN'; }); s.grants = [{ userId: 'fictional', role: 'admin', villages: s.villages.map(v => v.id), active: true }]; });
    const domain = createDomain(store, () => Date.parse('2026-10-12T00:00:00+08:00'));
    const call = (command, payload) => domain.dispatch('fictional', command, payload, randomUUID());
    assert.throws(() => call(person.command, { ...person.payload, villages: [villageA] }), /PERSONAL_CONSENT_REQUIRED/);
    assert.throws(() => call(request.command, { ...request.payload, village: villageA }), /PERSONAL_CONSENT_REQUIRED/);
    // Explicitly fictional test consent, never a production bootstrap.
    const p = call(person.command, { ...person.payload, villages: [villageA], consent: true, verified: true });
    assert.equal(p.status, 'ACTIVE');
    let r = call(request.command, { ...request.payload, village: villageA, consent: true });
    assert.equal(r.status, 'RECEIVED');
    r = call('request.verify', { id: r.id, version: r.version, evidence: 'Fictional test only', scopeSafe: true });
    assert.throws(() => domain.matches('fictional', { ...matches, request: r.id, version: 1 }), /STALE_VERSION/);
    const result = domain.matches('fictional', { ...matches, request: r.id, version: r.version });
    assert.equal(result.request, r.id); assert.deepEqual(store.read().orders, []); assert.deepEqual(store.read().bookings, []);
  } finally { store.db.close(); }
});

test('reusable documentation exists and every local Markdown link resolves within this template', () => {
  const files = ['README.md', 'README.en.md', 'SECURITY.md', 'CONTRIBUTING.md', 'docs/quick-start.md', 'docs/deployment.md', 'docs/operations.md', 'docs/identity-operations.md', 'docs/data-fields.md', 'docs/api.md'];
  for (const file of files) {
    assert.ok(existsSync(file), 'missing guide: ' + file);
    for (const match of readFileSync(file, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
      const link = match[1].split('#')[0]; if (!link || /^[a-z]+:/i.test(link)) continue;
      const target = resolve(dirname(file), link);
      assert.ok(target.startsWith(resolve('.') + '/') || target.startsWith(resolve('.') + '\\'));
      assert.ok(existsSync(target), `${file}: missing link ${link}`);
    }
  }
});
