import { villageA, villageB } from '../fixture-villages.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';

test('backup activation needs both personal confirmations and does not use initial hold deadline', () => {
  const f = fixture(); let o = f.confirm(f.call('order.reserve', f.terms(f.request())));
  f.setTime('2026-10-12T08:55:00+08:00');
  assert.throws(() => f.call('order.activate-backup', { id: o.id, version: o.version, evidence: '未联系', farmer: true, backup: false }), /CONSENT/);
  o = f.call('order.activate-backup', { id: o.id, version: o.version, farmer: true, backup: true, evidence: '双方电话核实原约定' });
  assert.equal(o.activeProvider, f.backup); assert.equal(o.backupActivation.at, Date.parse('2026-10-12T08:55:00+08:00'));
  f.store.db.close();
});

test('overtime preserves original resources if consent or availability is missing', () => {
  const f = fixture(); let o = f.confirm(f.call('order.reserve', f.terms(f.request(), { overtimeMax: 60 })));
  f.setTime('2026-10-12T09:00:00+08:00');
  o = f.call('order.handoff', { id: o.id, version: o.version, weather: true, tools: true, scope: true, farmer: true, provider: true, evidence: '现场核实' });
  o = f.call('order.start', { id: o.id, version: o.version, actualAt: '2026-10-12T09:00:00+08:00' });
  assert.throws(() => f.call('order.overtime', { id: o.id, version: o.version, minutes: 61, farmer: true, main: true, backup: true, evidence: '本人确认' }), /OVERTIME/);
  o = f.call('order.overtime', { id: o.id, version: o.version, minutes: 30, farmer: true, main: true, backup: true, evidence: '本人确认时段和价格' });
  assert.equal(o.termsVersion, 2); assert.equal(o.terms.end, Date.parse('2026-10-12T10:30:00+08:00')); assert.equal(o.history.length, 2);
  f.store.db.close();
});

test('independent reviewer only sees assigned complaint and cannot review own involvement', () => {
  const f = fixture(); const o = f.confirm(f.call('order.reserve', f.terms(f.request())));
  f.store.transact(s => { s.grants.push({ userId: 'reviewer', role: 'reviewer', villages: [villageA], active: true }); });
  const c = f.call('complaint.create', { order: o.id, reason: '虚构收费争议', reviewer: 'reviewer', involved: ['adult'], consent: true });
  const view = f.domain.snapshot('reviewer'); assert.equal(view.complaints.length, 1); assert.equal(view.orders, undefined);
  assert.throws(() => f.call('complaint.review', { id: c.id, version: c.version, conclusion: '核实双方陈述' }), /INDEPENDENT/);
  const reviewed = f.call('complaint.review', { id: c.id, version: c.version, conclusion: '分别沟通；保留金额争议', evidence: '复核记录编号 R01' }, 'reviewer');
  assert.equal(reviewed.status, 'REVIEWED');
  f.store.db.close();
});

test('print is a necessary-field single order projection and enforces village/role access', () => {
  const f = fixture(); const o = f.confirm(f.call('order.reserve', f.terms(f.request(villageB))));
  assert.throws(() => f.domain.print('local', o.id, 'farmer'), /FORBIDDEN/);
  assert.throws(() => f.domain.print('student', o.id, 'farmer'), /FORBIDDEN/);
  const card = f.domain.print('adult', o.id, 'farmer');
  assert.equal(card.code, o.code); assert.equal(card.recipient, 'farmer'); assert.equal(card.termsVersion, 1);
  assert.equal(card.people, undefined); assert.equal(card.requests, undefined); assert.equal(card.phone, undefined);
  f.store.db.close();
});

test('a provider can be assigned across authorized villages without duplicate identity', () => {
  const f = fixture(); let p = f.call('person.create', { name: '虚构多村提供方', villages: [villageA], skills: ['sorting'], consent: true, verified: true });
  assert.throws(() => f.call('person.scope', { id: p.id, version: p.version, villages: [villageA, villageB], skills: ['sorting'], consent: true, verified: true }, 'local'), /FORBIDDEN/);
  p = f.call('person.scope', { id: p.id, version: p.version, villages: [villageA, villageB], skills: ['sorting', 'packing'], consent: true, verified: true });
  assert.equal(f.store.read().people.filter(x => x.id === p.id).length, 1); assert.deepEqual(p.villages, [villageA, villageB]); f.store.db.close();
});

test('a reviewer retry returns the same authorized complaint outcome', () => {
  const f = fixture(); const o = f.confirm(f.call('order.reserve', f.terms(f.request())));
  f.store.transact(s => s.grants.push({ userId: 'reviewer', role: 'reviewer', villages: [villageA], active: true }));
  const c = f.call('complaint.create', { order: o.id, reason: '虚构争议', reviewer: 'reviewer', involved: [], consent: true });
  const payload = { id: c.id, version: c.version, conclusion: '保留双方陈述', evidence: '复核编号' };
  const a = f.call('complaint.review', payload, 'reviewer', 'review-retry-01'); const b = f.call('complaint.review', payload, 'reviewer', 'review-retry-01'); assert.deepEqual(a, b); f.store.db.close();
});

test('retention review appears after 90 days, never deletes automatically, and excludes unresolved disputes', () => {
  const f = fixture(); let r = f.request(); r = f.call('request.disposition', { id: r.id, version: r.version, status: 'CLOSED', reason: '虚构结束' });
  const o = f.confirm(f.call('order.reserve', f.terms(f.request())));
  f.store.transact(s => { const order = s.orders.find(x => x.id === o.id); order.status = 'COMPLETED'; order.actualEnd = Date.parse('2026-10-12T10:00:00+08:00'); order.payment = { main: { status: 'disputed' } }; });
  f.setTime('2027-01-11T00:00:00+08:00');
  const review = f.domain.snapshot('adult').retention;
  assert.equal(review.length, 1); assert.equal(review[0].id, r.id); assert.equal(f.store.read().requests[0].phone, '13800001234');
  assert.equal(f.domain.snapshot('student').retention, undefined); f.store.db.close();
});

test('late dispute resolution starts a fresh retention interval and exited providers get a review task', () => {
  const f = fixture(); const o = f.confirm(f.call('order.reserve', f.terms(f.request())));
  f.store.transact(s => { const order = s.orders.find(x => x.id === o.id); order.status = 'COMPLETED'; order.actualEnd = Date.parse('2026-10-12T10:00:00+08:00'); order.payment = { main: { status: 'agreed', farmer: { at: Date.parse('2027-02-10T00:00:00+08:00') }, provider: { at: Date.parse('2027-02-10T00:00:00+08:00') } } }; });
  f.setTime('2027-02-11T00:00:00+08:00'); assert.equal(f.domain.snapshot('adult').retention.length, 0);
  const p = f.call('person.create', { name: '虚构退出人员', villages: [villageA], skills: ['sorting'], consent: true, verified: true });
  f.call('person.status', { id: p.id, version: p.version, status: 'EXITED', reason: '本人退出' }); f.setTime('2027-05-12T00:00:00+08:00');
  assert.equal(f.domain.snapshot('adult').retention.some(x => x.type === 'person' && x.id === p.id), true); f.store.db.close();
});

test('person changes stay blocked until all parties recheck the unchanged arrangement', () => {
  const f = fixture(); let o = f.confirm(f.call('order.reserve', f.terms(f.request())));
  const p = f.store.read().people.find(p => p.id === f.main);
  const paused = f.call('person.status', { id: p.id, version: p.version, status: 'PAUSED', reason: '本人暂停' });
  assert.throws(() => f.call('order.recheck-people', { id: o.id, version: o.version, farmer: true, main: true, backup: true, evidence: '本人核实' }), /ELIGIBLE/);
  f.call('person.status', { id: p.id, version: paused.version, status: 'ACTIVE', reason: '本人恢复' });
  o = f.call('order.recheck-people', { id: o.id, version: o.version, farmer: true, main: true, backup: true, evidence: '分别核实未改变的本版安排' });
  assert.equal(o.personFollowup, false); assert.equal(o.status, 'CONFIRMED'); f.store.db.close();
});
