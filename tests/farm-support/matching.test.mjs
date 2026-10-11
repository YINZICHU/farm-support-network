import { villageA, villageB } from '../fixture-villages.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';

const slot = r => ({ request: r.id, version: r.version, start: '2026-10-12T09:00:00+08:00', end: '2026-10-12T10:00:00+08:00' });
const usual = { days: [1, 2, 3, 4], start: '07:00', end: '18:00' };
function provider(f, options = {}) {
  return f.call('person.create', { name: '虚构通常可用人员', phone: '000-DEMO-ONLY', villages: [villageA], skills: ['sorting'], consent: true, verified: true, pattern: usual, ...options });
}

test('recommendations are masked, deterministic and do not create reservations', () => {
  const f = fixture(); try {
    const r = f.request(), before = f.store.read();
    const result = f.domain.matches('local', slot(r));
    assert.deepEqual(result.candidates.map(p => p.id), [f.main, f.backup]);
    assert.equal(result.candidates[0].availabilityStatus, 'confirmed');
    assert.ok(result.candidates[0].reasons.length >= 3);
    assert.doesNotMatch(JSON.stringify(result), /虚构甲|13800001234|evidence|phone|name/);
    assert.deepEqual(f.store.read(), before);
  } finally { f.store.db.close(); }
});

test('weekday patterns are stored as preferences, not dated confirmation', () => {
  const f = fixture(); try {
    const p = provider(f), r = f.request();
    assert.deepEqual(p.pattern.days, [1, 2, 3, 4]);
    assert.deepEqual(p.availability, []);
    const candidate = f.domain.matches('adult', slot(r)).candidates.find(c => c.id === p.id);
    assert.equal(candidate.availabilityStatus, 'usual');
    assert.throws(() => f.call('order.reserve', f.terms(r, { main: p.id })), /AVAILABILITY_NOT_CONFIRMED/);
    const view = f.domain.snapshot('local').people.find(c => c.id === p.id);
    assert.deepEqual(view.pattern.days, [1, 2, 3, 4]);
  } finally { f.store.db.close(); }
});

test('weekday and full buffered time must match in Shanghai time', () => {
  const f = fixture(); try {
    const p = provider(f), r = f.request();
    for (const input of [
      { start: '2026-10-16T09:00:00+08:00', end: '2026-10-16T10:00:00+08:00' },
      { start: '2026-10-12T07:00:00+08:00', end: '2026-10-12T08:00:00+08:00' },
      { start: '2026-10-12T17:00:00+08:00', end: '2026-10-12T18:00:00+08:00' },
      { start: '2026-10-12T23:30:00+08:00', end: '2026-10-13T00:30:00+08:00' },
    ]) assert.ok(!f.domain.matches('adult', { ...slot(r), ...input }).candidates.some(c => c.id === p.id));
    const utc = f.domain.matches('adult', { ...slot(r), start: '2026-10-12T01:00:00Z', end: '2026-10-12T02:00:00Z' });
    assert.equal(utc.candidates.find(c => c.id === p.id).availabilityStatus, 'usual');
  } finally { f.store.db.close(); }
});

test('inactive, wrong-skill, wrong-village and known unavailable people are excluded', () => {
  const f = fixture(); try {
    const wrongSkill = provider(f, { skills: ['packing'] });
    const wrongVillage = provider(f, { villages: [villageB] });
    const paused = provider(f); f.call('person.status', { id: paused.id, version: paused.version, status: 'PAUSED', reason: '本人暂停' });
    const unknown = provider(f, { pattern: null });
    const r = f.request(), list = f.domain.matches('adult', slot(r)).candidates;
    for (const id of [wrongSkill.id, wrongVillage.id, paused.id]) assert.ok(!list.some(p => p.id === id));
    assert.equal(list.find(p => p.id === unknown.id).availabilityStatus, 'needs-confirmation');
  } finally { f.store.db.close(); }
});

test('matching sees cross-village holds but does not expose that village or order', () => {
  const f = fixture(); try {
    const other = f.request(villageB); f.call('order.reserve', f.terms(other));
    const local = f.request(), result = f.domain.matches('local', slot(local));
    assert.deepEqual(result.candidates, []);
    assert.ok(!JSON.stringify(result).includes(villageB)); assert.doesNotMatch(JSON.stringify(result), /F-2026/);
    f.setTime('2026-10-12T02:01:00+08:00');
    assert.equal(f.domain.matches('local', slot(local)).candidates.length, 2);
  } finally { f.store.db.close(); }
});

test('an unfinished service blocks its people even after its planned end', () => {
  const f = fixture(); try {
    const o = f.confirm(f.call('order.reserve', f.terms(f.request(villageB))));
    f.setTime('2026-10-12T08:30:00+08:00');
    let ready = f.call('order.handoff', { id: o.id, version: o.version, weather: true, tools: true, scope: true, farmer: true, provider: true, evidence: '当面交接' });
    f.setTime('2026-10-12T09:00:00+08:00');
    f.call('order.start', { id: ready.id, version: ready.version, actualAt: '2026-10-12T09:00:00+08:00' });
    f.setTime('2026-10-12T11:00:00+08:00');
    const result = f.domain.matches('local', { ...slot(f.request()), start: '2026-10-12T13:00:00+08:00', end: '2026-10-12T14:00:00+08:00' });
    assert.deepEqual(result.candidates, []);
  } finally { f.store.db.close(); }
});

test('capacity is reported separately from candidates and never creates a booking', () => {
  const f = fixture(); try {
    f.call('order.reserve', f.terms(f.request()));
    const p = provider(f), r = f.request(), result = f.domain.matches('local', slot(r));
    assert.equal(result.capacityAvailable, false);
    assert.ok(result.candidates.some(c => c.id === p.id));
    assert.equal(f.store.read().orders.length, 1);
  } finally { f.store.db.close(); }
});

test('matching enforces actor, village, request version and confirmed safety scope', () => {
  const f = fixture(); try {
    const r = f.request(villageB);
    assert.throws(() => f.domain.matches('local', slot(r)), /FORBIDDEN/);
    assert.throws(() => f.domain.matches('student', slot(r)), /FORBIDDEN/);
    assert.throws(() => f.domain.matches('anonymous', slot(r)), /LOGIN_REQUIRED/);
    assert.throws(() => f.domain.matches('adult', { ...slot(r), version: 1 }), /STALE_VERSION/);
    const unverified = f.call('request.create', { village: villageA, household: 'DEMO-MATCH', name: '虚构', phone: '000', task: 'sorting', note: '待核实', source: 'phone', actualAt: '2026-10-11T15:00:00+08:00', consent: true });
    assert.throws(() => f.domain.matches('adult', slot(unverified)), /REQUEST_NOT_AVAILABLE/);
    f.store.transact(s => { s.grants.find(g => g.userId === 'adult').active = false; });
    assert.throws(() => f.domain.matches('adult', slot(r)), /LOGIN_REQUIRED/);
  } finally { f.store.db.close(); }
});

test('invalid patterns and request dates are rejected rather than guessed', () => {
  const f = fixture(); try {
    for (const pattern of [ { ...usual, days: [0] }, { ...usual, days: [1, 1] }, { ...usual, days: [] }, { ...usual, start: '24:00' }, { ...usual, end: '06:00' }, { ...usual, days: ['1'] } ]) {
      assert.throws(() => provider(f, { pattern }), /INVALID_PATTERN/);
    }
    const r = f.request();
    assert.throws(() => f.domain.matches('adult', { ...slot(r), start: '2026-10-12T09:00:00' }), /INVALID_TIME/);
    assert.throws(() => f.domain.matches('adult', { ...slot(r), end: '2026-10-12T14:00:00+08:00' }), /MAX_FOUR_HOURS/);
    assert.throws(() => f.domain.matches('adult', { ...slot(r), start: '2026-10-11T09:00:00+08:00', end: '2026-10-11T10:00:00+08:00' }), /INVALID_TIME/);
  } finally { f.store.db.close(); }
});

test('usual pattern changes require consent, scope and current version and can be cleared', () => {
  const f = fixture(); try {
    const p = provider(f);
    assert.throws(() => f.call('person.pattern', { id: p.id, version: p.version, pattern: usual, consent: false }), /CONSENT/);
    assert.throws(() => f.call('person.pattern', { id: f.main, version: 2, pattern: usual, consent: true }, 'local'), /FORBIDDEN/);
    const changed = f.call('person.pattern', { id: p.id, version: p.version, pattern: { ...usual, days: [2] }, consent: true });
    assert.throws(() => f.call('person.pattern', { id: p.id, version: p.version, pattern: null, consent: true }), /STALE_VERSION/);
    const cleared = f.call('person.pattern', { id: p.id, version: changed.version, pattern: null, consent: true });
    assert.equal(cleared.pattern, null);
  } finally { f.store.db.close(); }
});

test('a recommendation is not a lock and final reservation rechecks intervening conflicts', () => {
  const f = fixture(); try {
    const r = f.request(); assert.equal(f.domain.matches('local', slot(r)).candidates.length, 2);
    f.call('order.reserve', f.terms(f.request(villageB)));
    assert.throws(() => f.call('order.reserve', f.terms(r)), /PERSON_CONFLICT/);
  } finally { f.store.db.close(); }
});

test('matching and first reservation require more than one hour of lead time', () => {
  const f = fixture(); try {
    const r = f.request();
    for (const now of ['2026-10-12T08:30:00+08:00', '2026-10-12T08:00:00+08:00']) {
      f.setTime(now);
      assert.throws(() => f.domain.matches('local', slot(r)), /HOLD_DEADLINE/);
      assert.throws(() => f.call('order.reserve', f.terms(r)), /HOLD_DEADLINE/);
      assert.equal(f.store.read().orders.length, 0);
    }
    f.setTime('2026-10-12T07:59:59+08:00');
    assert.equal(f.domain.matches('local', slot(r)).candidates.length, 2);
    assert.equal(f.call('order.reserve', f.terms(r)).status, 'AWAITING_CONFIRMATION');
  } finally { f.store.db.close(); }
});
