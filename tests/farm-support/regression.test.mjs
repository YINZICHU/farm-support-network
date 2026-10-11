import { villageA, villageB } from '../fixture-villages.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { createDomain } from '../../server/farm-support/domain.mjs';

const change = (f, o, overrides) => {
  o = f.call('order.propose', { id: o.id, version: o.version, terms: { ...o.terms, ...overrides }, reason: '本人共同确认修改' });
  for (const party of ['farmer', 'main', 'backup']) o = f.call('order.confirm-change', { id: o.id, version: o.version, party, agree: true, method: 'phone', actualAt: '2026-10-12T00:00:00+08:00', evidence: '本人核实新版' });
  return o;
};

test('expiry is evaluated after taking the command lock and releases resources even on rejection', () => {
  const f = fixture(); let o = f.call('order.reserve', f.terms(f.request()));
  for (const party of ['farmer', 'main']) o = f.call('order.confirm', { id: o.id, version: o.version, party, agree: true, method: 'phone', actualAt: '2026-10-12T00:00:00+08:00', evidence: '本人核实' });
  let n = o.holdUntil - 100;
  const wrapped = { read: f.store.read, transact(fn) { n = o.holdUntil + 100; return f.store.transact(fn); } };
  const d = createDomain(wrapped, () => n);
  assert.throws(() => d.dispatch('adult', 'order.confirm', { id: o.id, version: o.version, party: 'backup', agree: true, method: 'phone', actualAt: '2026-10-12T00:00:00+08:00', evidence: '本人核实' }, 'deadline-regression'), /HOLD_EXPIRED/);
  assert.equal(f.store.read().orders[0].status, 'DRAFT'); assert.equal(f.store.read().bookings.length, 0); f.store.db.close();
});

test('new agreements preserve old confirmations and control the current overtime limit', () => {
  const f = fixture(); let o = f.confirm(f.call('order.reserve', f.terms(f.request())));
  const original = structuredClone(o.confirmations);
  o = change(f, o, { overtimeMax: 0 });
  assert.deepEqual(o.history[0].confirmations, original);
  f.setTime('2026-10-12T09:00:00+08:00');
  o = f.call('order.handoff', { id: o.id, version: o.version, weather: true, tools: true, scope: true, farmer: true, provider: true, evidence: '现场核实' });
  o = f.call('order.start', { id: o.id, version: o.version, actualAt: '2026-10-12T09:00:00+08:00' });
  assert.throws(() => f.call('order.overtime', { id: o.id, version: o.version, minutes: 30, farmer: true, main: true, backup: true, evidence: '本人确认' }), /OVERTIME/); f.store.db.close();
});

test('lower future capacity does not invalidate an already confirmed arrangement', () => {
  const f = fixture(); f.call('settings.village', { ...f.store.read().villages.find(v => v.id === villageA), state: 'OPEN', capacity: 2, evidence: 'Verified future capacity' });
  let o = f.confirm(f.call('order.reserve', f.terms(f.request())));
  f.confirm(f.call('order.reserve', f.terms(f.request(), { start: '2026-10-12T11:00:00+08:00', end: '2026-10-12T11:30:00+08:00' })));
  f.call('settings.village', { ...f.store.read().villages.find(v => v.id === villageA), state: 'OPEN', capacity: 1, evidence: 'Verified future capacity' }); f.setTime('2026-10-12T09:00:00+08:00');
  o = f.call('order.handoff', { id: o.id, version: o.version, weather: true, tools: true, scope: true, farmer: true, provider: true, evidence: '现场核实' });
  o = f.call('order.start', { id: o.id, version: o.version, actualAt: '2026-10-12T09:00:00+08:00' }); assert.equal(o.status, 'IN_SERVICE'); f.store.db.close();
});

test('locations are only disclosed through the audited single-record projection', () => {
  const f = fixture(); const o = f.confirm(f.call('order.reserve', f.terms(f.request())));
  const view = f.domain.snapshot('adult'); assert.equal(view.orders[0].terms.site, undefined); assert.equal(view.orders[0].history[0].terms.site, undefined);
  assert.equal(f.domain.contact('adult', 'order', o.id).site, o.terms.site); f.store.db.close();
});

test('location reveal is bound to the selected order, never a canceled earlier arrangement', () => {
  const f = fixture(), r = f.request(); let a = f.call('order.reserve', f.terms(r, { site: '虚构旧地点 A' }));
  f.call('order.cancel', { id: a.id, version: a.version, reason: '重新核实地点' });
  const b = f.call('order.reserve', f.terms(r, { site: '虚构新地点 B' }));
  const reveal = f.domain.contact('adult', 'order', b.id); assert.equal(reveal.site, '虚构新地点 B'); assert.equal(reveal.order, b.id);
  assert.equal(f.domain.contact('adult', 'request', r.id).site, undefined); f.store.db.close();
});

test('a new main in a post-backup change must have verified availability', () => {
  const f = fixture(); let o = f.confirm(f.call('order.reserve', f.terms(f.request())));
  o = f.call('order.activate-backup', { id: o.id, version: o.version, farmer: true, backup: true, evidence: '本人核实备用启用' });
  const p = f.call('person.create', { name: '虚构无时段人员', villages: [villageA], skills: ['sorting'], consent: true, verified: true });
  o = f.call('order.propose', { id: o.id, version: o.version, terms: { ...o.terms, main: p.id }, reason: '更换主岗需要重新确认' });
  for (const party of ['farmer', 'main']) o = f.call('order.confirm-change', { id: o.id, version: o.version, party, agree: true, method: 'phone', actualAt: '2026-10-12T00:00:00+08:00', evidence: '本人核实' });
  assert.throws(() => f.call('order.confirm-change', { id: o.id, version: o.version, party: 'backup', agree: true, method: 'phone', actualAt: '2026-10-12T00:00:00+08:00', evidence: '本人核实' }), /AVAILABILITY/);
  assert.equal(f.store.read().orders[0].activeProvider, f.backup);
  f.store.db.close();
});

test('village-scoped admins cannot inspect or revoke other-village grants or global settings', () => {
  const f = fixture(); f.store.transact(s => { s.grants.push({ userId: 'scoped', role: 'admin', villages: [villageA], active: true }, { userId: 'other', role: 'coordinator', villages: [villageB], active: true }); });
  assert.equal(f.domain.snapshot('scoped').grants, undefined);
  assert.throws(() => f.call('grant.revoke', { userId: 'other' }, 'scoped'), /FORBIDDEN/);
  assert.throws(() => f.call('settings.program', { state: 'PAUSED' }, 'scoped'), /FORBIDDEN/);
  f.store.db.close();
});
