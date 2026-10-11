import { villageA, villageB } from '../fixture-villages.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { openStore } from '../../server/farm-support/store.mjs';
import { createDomain } from '../../server/farm-support/domain.mjs';

import { fixture } from './helpers.mjs';

test('public and unauthorized villages cannot create or inspect private records', () => {
  const f = fixture();
  assert.throws(() => f.call('request.create', {}, 'anonymous'), /LOGIN/);
  assert.throws(() => f.call('request.create', { village: villageB }, 'local'), /FORBIDDEN/);
  assert.throws(() => f.call('person.create', {}, 'student'), /FORBIDDEN/);
  const summary = f.domain.snapshot('student');
  assert.equal(summary.people, undefined); assert.equal(summary.requests, undefined);
  f.store.transact(s => { s.grants.find(g => g.userId === 'local').active = false; });
  assert.throws(() => f.domain.snapshot('local'), /LOGIN/);
  f.store.db.close();
});

test('a main/backup hold occupies one village slot and both people across villages', () => {
  const f = fixture(), r = f.request(), order = f.call('order.reserve', f.terms(r));
  assert.equal(order.status, 'AWAITING_CONFIRMATION');
  assert.equal(f.store.read().bookings.length, 2);
  const other = f.request(villageB);
  assert.throws(() => f.call('order.reserve', f.terms(other)), /PERSON_CONFLICT/);
  assert.throws(() => f.call('order.reserve', f.terms(other, { backup: f.main })), /DISTINCT/);
  f.store.db.close();
});

test('village capacity applies even to different people and covers both half-days', () => {
  const f = fixture(), r = f.request(); f.call('order.reserve', f.terms(r, { start: '2026-10-12T11:30:00+08:00', end: '2026-10-12T12:30:00+08:00' }));
  const ids = [];
  for (const name of ['虚构丙', '虚构丁']) {
    const p = f.call('person.create', { name, villages: [villageA], skills: ['sorting'], consent: true, verified: true });
    f.call('person.availability', { id: p.id, version: 1, start: '2026-10-12T07:00:00+08:00', end: '2026-10-12T20:00:00+08:00', evidence: '本人电话同意', consent: true }); ids.push(p.id);
  }
  assert.throws(() => f.call('order.reserve', f.terms(f.request(), { main: ids[0], backup: ids[1], start: '2026-10-12T15:00:00+08:00', end: '2026-10-12T16:00:00+08:00' })), /CAPACITY/);
  f.store.db.close();
});

test('all three parties confirm separately; expired holds cannot become confirmed', () => {
  const f = fixture(); let o = f.call('order.reserve', f.terms(f.request()));
  o = f.call('order.confirm', { id: o.id, version: 1, party: 'farmer', agree: true, method: 'phone', actualAt: '2026-10-12T00:00:00+08:00', evidence: '本人核实' });
  assert.equal(o.status, 'AWAITING_CONFIRMATION');
  f.setTime('2026-10-12T02:00:00+08:00');
  assert.throws(() => f.confirm(o), /HOLD_EXPIRED/);
  assert.equal(f.store.read().bookings.length, 0);
  f.store.db.close();
});

test('confirmed bookings do not expire; stale/replayed writes cannot duplicate a reservation', () => {
  const f = fixture(), payload = f.terms(f.request()), key = randomUUID();
  const first = f.call('order.reserve', payload, 'adult', key), again = f.call('order.reserve', payload, 'adult', key);
  assert.equal(first.id, again.id); assert.equal(f.store.read().orders.length, 1);
  assert.throws(() => f.call('order.reserve', { ...payload, site: 'changed' }, 'adult', key), /IDEMPOTENCY/);
  const confirmed = f.confirm(first); assert.equal(confirmed.status, 'CONFIRMED');
  f.setTime('2026-10-12T08:45:00+08:00');
  assert.equal(f.store.read().bookings.length, 2);
  assert.throws(() => f.call('order.cancel', { id: confirmed.id, version: 1, reason: '本人退出' }), /STALE/);
  f.store.db.close();
});

test('failed confirmed change keeps original terms and bookings', () => {
  const f = fixture(); let o = f.confirm(f.call('order.reserve', f.terms(f.request())));
  o = f.call('order.propose', { id: o.id, version: o.version, terms: { ...o.terms, start: '2026-10-12T06:00:00+08:00', end: '2026-10-12T07:00:00+08:00' }, reason: '当事人要求改时段' });
  for (const party of ['farmer', 'main']) o = f.call('order.confirm-change', { id: o.id, version: o.version, party, evidence: '现场本人同意', method: 'in-person', actualAt: '2026-10-12T00:00:00+08:00', agree: true });
  assert.throws(() => f.call('order.confirm-change', { id: o.id, version: o.version, party: 'backup', evidence: '现场本人同意', method: 'in-person', actualAt: '2026-10-12T00:00:00+08:00', agree: true }), /AVAILABILITY/);
  const stored = f.store.read().orders[0];
  assert.equal(stored.terms.start, Date.parse('2026-10-12T09:00:00+08:00'));
  assert.equal(f.store.read().bookings.length, 2); assert.equal(stored.history.length, 1);
  f.store.db.close();
});

test('handoff, safe end, independent acceptance, disputed payment and refused follow-up remain separate', () => {
  const f = fixture(); let o = f.confirm(f.call('order.reserve', f.terms(f.request())));
  f.setTime('2026-10-12T09:00:00+08:00');
  assert.throws(() => f.call('order.start', { id: o.id, version: o.version }), /HANDOFF/);
  o = f.call('order.handoff', { id: o.id, version: o.version, weather: true, tools: true, scope: true, farmer: true, provider: true, evidence: '现场逐项核实' });
  o = f.call('order.start', { id: o.id, version: o.version, actualAt: '2026-10-12T09:00:00+08:00' });
  assert.throws(() => f.call('order.cancel', { id: o.id, version: o.version, reason: '中止' }), /STARTED/);
  f.setTime('2026-10-12T10:00:00+08:00');
  o = f.call('order.safe-end', { id: o.id, version: o.version, actualAt: '2026-10-12T10:00:00+08:00', safe: true, evidence: '现场安全收尾核实' });
  assert.equal(f.store.read().bookings.length, 0); assert.equal(o.status, 'AWAITING_ACCEPTANCE');
  o = f.call('order.accept', { id: o.id, version: o.version, party: 'farmer', result: 'complete', evidence: '本人电话核实' });
  o = f.call('order.accept', { id: o.id, version: o.version, party: 'main', result: 'partial', evidence: '本人电话核实' });
  assert.equal(o.status, 'AWAITING_ACCEPTANCE'); assert.equal(o.acceptanceDispute, true);
  o = f.call('order.payment', { id: o.id, version: o.version, party: 'farmer', recipient: 'main', amount: 5000, evidence: '付款方陈述' });
  o = f.call('order.payment', { id: o.id, version: o.version, party: 'provider', recipient: 'main', amount: 3000, evidence: '收款方陈述' });
  assert.equal(o.payment.main.status, 'disputed');
  f.setTime('2026-10-13T10:00:00+08:00');
  o = f.call('order.followup', { id: o.id, version: o.version, party: 'farmer', outcome: 'refused', evidence: '本人拒绝回访' });
  assert.throws(() => f.call('order.followup', { id: o.id, version: o.version, party: 'farmer', outcome: 'answered', evidence: '再打电话' }), /FOLLOWUP_CLOSED/);
  assert.doesNotMatch(JSON.stringify(f.domain.snapshot('student')), /13800001234|虚构农户|虚构地点/);
  f.store.db.close();
});
