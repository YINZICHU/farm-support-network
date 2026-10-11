import { randomUUID, createHash } from 'node:crypto';
import { taskKinds } from '../../src/farm-support/model.js';
import { normalizePattern, personIsBusy, recommendPeople } from './matching.mjs';
import { grantCapabilities, mayManageVillage } from '../../src/farm-support/permissions.js';
import { normalizeVillageName, villageNameKey, assertVillageRegistry } from '../../src/farm-support/village-registry.js';
import { projectConfig } from '../../src/farm-support/project-config.js';

export class ServiceError extends Error { constructor(code, status = 409) { super(code); this.code = code; this.status = status; } }
const fail = (code, status) => { throw new ServiceError(code, status); };
const text = (value, max = 300) => { if (typeof value !== 'string' || !value.trim() || value.length > max) fail('INVALID_TEXT', 400); return value.trim(); };
const time = value => { const t = typeof value === 'number' ? value : Date.parse(value); if (!Number.isFinite(t) || (typeof value === 'string' && !/(Z|[+-]\d\d:\d\d)$/.test(value))) fail('INVALID_TIME', 400); return t; };
const money = value => { if (value === null) return null; if (!Number.isSafeInteger(value) || value < 0 || value > 10000000) fail('INVALID_AMOUNT', 400); return value; };
const agree = value => { if (value !== true) fail('PERSONAL_CONSENT_REQUIRED', 400); };
const lookup = (list, id) => list.find(x => x.id === id) || fail('NOT_FOUND', 404);
const checkVersion = (obj, version) => { if (obj.version !== version) fail('STALE_VERSION'); };
function grant(state, userId) { return state.grants.find(g => g.userId === userId && g.active) || fail('LOGIN_REQUIRED', 401); }
function authorize(g, village) { if (!['admin', 'coordinator'].includes(g.role) || !g.villages.includes(village)) fail('FORBIDDEN', 403); }
function admin(g) { if (g.role !== 'admin') fail('FORBIDDEN', 403); }
function projectAdmin(g) { if (!grantCapabilities(g).projectAdmin) fail('FORBIDDEN', 403); }
function authorizeCommand(g, command, payload) {
  if (!['admin', 'coordinator'].includes(g.role) && !(g.role === 'reviewer' && command === 'complaint.review')) fail('FORBIDDEN', 403);
  if (command === 'village.create' && !(grantCapabilities(g).projectAdmin || grantCapabilities(g).canCreateVillages)) fail('FORBIDDEN', 403);
  if (command === 'settings.village' && !mayManageVillage(g, payload.id)) fail('FORBIDDEN', 403);
  if (['settings.program', 'grant.permissions', 'grant.revoke'].includes(command)) projectAdmin(g);
  if (command.startsWith('privacy.')) admin(g);
}
function villageNames(state, payload, excluded) {
  let zh, en;
  try { zh = normalizeVillageName(payload.zh); en = normalizeVillageName(payload.en); } catch { fail('INVALID_VILLAGE_NAME', 400); }
  if (state.villages.some(v => v.id !== excluded && (villageNameKey(v.zh, 'zh') === villageNameKey(zh, 'zh') || villageNameKey(v.en, 'en') === villageNameKey(en, 'en')))) fail('VILLAGE_NAME_DUPLICATE');
  return { zh, en };
}
function clearSessions(store, userId) {
  if (store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session'").get()) store.db.prepare('DELETE FROM session WHERE userId=?').run(userId);
}
function open(state, village) { const v = lookup(state.villages, village); if (state.program !== 'OPEN' || v.state !== 'OPEN') fail('SERVICE_NOT_OPEN'); return v; }
const halfDays = (start, end) => { const result = []; for (let n = Math.floor((start + 28800000) / 43200000); n <= Math.floor((end - 1 + 28800000) / 43200000); n++) result.push(n); return result; };
function expire(state, now) {
  for (const o of state.orders) if (o.status === 'AWAITING_CONFIRMATION' && o.holdUntil <= now) { o.status = 'DRAFT'; o.version++; o.holdExpired = true; state.bookings = state.bookings.filter(b => b.order !== o.id); state.audit.push({ at: now, actor: 'system', command: 'hold.expired', object: o.id }); }
}
function terms(input, task) {
  const out = { task, start: time(input.start), end: time(input.end), main: text(input.main, 80), backup: text(input.backup, 80) };
  if (out.main === out.backup) fail('MAIN_BACKUP_MUST_BE_DISTINCT');
  if (out.end <= out.start || out.end - out.start > 14400000) fail('MAX_FOUR_HOURS', 400);
  for (const field of ['site', 'standard', 'prohibited', 'safety', 'backupTerms', 'feeIncludes', 'cancelTerms']) out[field] = text(input[field]);
  for (const field of ['feeMain', 'feeBackup', 'overtimePrice']) out[field] = money(input[field]);
  out.overtimeMax = input.overtimeMax;
  if (!Number.isInteger(out.overtimeMax) || out.overtimeMax < 0 || out.overtimeMax > 60) fail('INVALID_OVERTIME', 400);
  out.before = 1800000; out.after = 1800000;
  return out;
}
function allocate(state, order, t, now, excluded = order.id, preserveCapacity = false) {
  const range = { start: t.start - t.before, end: t.end + t.after };
  const active = state.bookings.filter(b => b.order !== excluded && (b.kind === 'confirmed' || b.expires > now));
  for (const id of [t.main, t.backup]) {
    if (order.backupActivation && id === t.main) continue;
    const p = lookup(state.people, id);
    if (p.status !== 'ACTIVE' || !p.consent || !p.skills.includes(t.task) || !p.villages.includes(order.village)) fail('PERSON_NOT_ELIGIBLE');
    if (!p.availability.some(a => a.start <= range.start && a.end >= range.end)) fail('AVAILABILITY_NOT_CONFIRMED');
    if (personIsBusy(state, id, range, now, excluded)) fail('PERSON_CONFLICT');
  }
  const occupied = [...new Set(active.filter(b => b.village === order.village).map(b => b.order))].map(id => active.find(b => b.order === id));
  const capacity = preserveCapacity && order.rules ? order.rules.capacity : lookup(state.villages, order.village).capacity;
  for (const h of halfDays(range.start, range.end)) if (occupied.filter(b => halfDays(b.start, b.end).includes(h)).length >= capacity) fail('VILLAGE_CAPACITY');
  return range;
}
function bookings(state, o, range, kind) {
  state.bookings = state.bookings.filter(b => b.order !== o.id);
  for (const [role, person] of [['main', o.terms.main], ['backup', o.terms.backup]]) state.bookings.push({ order: o.id, village: o.village, person, role, ...range, kind, expires: kind === 'hold' ? o.holdUntil : null });
}
function confirmation(payload, now, termVersion, actor) {
  if (!['farmer', 'main', 'backup'].includes(payload.party)) fail('INVALID_PARTY', 400);
  if (!['phone', 'in-person', 'paper'].includes(payload.method)) fail('INVALID_CONFIRMATION_METHOD', 400);
  const actualAt = time(payload.actualAt);
  if (actualAt > now || actualAt < now - 7 * 86400000) fail('INVALID_CONFIRMATION_TIME', 400);
  if (typeof payload.agree !== 'boolean') fail('INVALID_AGREEMENT', 400);
  return { party: payload.party, agree: payload.agree, actualAt, enteredAt: now, method: payload.method, evidence: text(payload.evidence, 120), actor, termVersion };
}
function allAgree(confirmations) { return ['farmer', 'main', 'backup'].every(p => confirmations[p]?.agree === true); }
function projectedOrder(o) {
  const copy = structuredClone(o);
  delete copy.terms.site;
  for (const h of copy.history) delete h.terms.site;
  if (copy.proposal) delete copy.proposal.terms.site;
  for (const p of copy.proposalArchive || []) delete p.terms.site;
  return copy;
}
function retentionWork(s, villages, now) {
  const items = [];
  for (const r of s.requests.filter(r => villages.includes(r.village) && !r.contactRemovedAt)) {
    const related = s.orders.filter(o => o.request === r.id);
    if (!related.length && !['CLOSED', 'WITHDRAWN', 'UNMATCHED', 'OUT_OF_SCOPE', 'MERGED'].includes(r.status)) continue;
    if (related.some(o => !['COMPLETED', 'PARTIAL', 'NOT_PERFORMED', 'CANCELLED'].includes(o.status) || Object.values(o.payment || {}).some(p => p.status === 'disputed'))) continue;
    const complaints = s.complaints.filter(c => related.some(o => o.id === c.order));
    if (complaints.some(c => c.status !== 'REVIEWED')) continue;
    const endedAt = Math.max(r.closedAt || r.enteredAt, ...related.flatMap(o => [o.actualEnd || o.cancelledAt || now, ...Object.values(o.acceptance || {}).map(x => x.at), ...Object.values(o.payment || {}).flatMap(x => [x.farmer?.at || 0, x.provider?.at || 0])]), ...complaints.map(c => c.reviewedAt));
    if (now >= endedAt + 90 * 86400000) items.push({ type: 'request', id: r.id, village: r.village, household: r.household, reviewDue: endedAt + 90 * 86400000 });
  }
  for (const p of s.people.filter(p => p.status === 'EXITED' && !p.contactRemovedAt && p.villages.every(v => villages.includes(v)))) {
    const related = s.orders.filter(o => [o.terms.main, o.terms.backup].includes(p.id));
    if (related.some(o => !['COMPLETED', 'PARTIAL', 'NOT_PERFORMED', 'CANCELLED'].includes(o.status) || Object.values(o.payment || {}).some(x => x.status === 'disputed'))) continue;
    const complaints = s.complaints.filter(c => related.some(o => o.id === c.order)); if (complaints.some(c => c.status !== 'REVIEWED')) continue;
    const endedAt = Math.max(p.statusChangedAt || now, ...related.flatMap(o => [o.actualEnd || o.cancelledAt || now, ...Object.values(o.acceptance || {}).map(x => x.at), ...Object.values(o.payment || {}).flatMap(x => [x.farmer?.at || 0, x.provider?.at || 0])]), ...complaints.map(c => c.reviewedAt));
    if (now >= endedAt + 90 * 86400000) items.push({ type: 'person', id: p.id, village: p.villages[0], household: p.code, reviewDue: endedAt + 90 * 86400000 });
  }
  return items;
}
function reminders(s, villages, now) {
  const items = [];
  for (const r of s.requests.filter(r => villages.includes(r.village) && r.status === 'WAITLISTED' && r.nextContact <= now)) items.push({ type: 'request', id: r.id, village: r.village, label: '候补联系已到约定时间' });
  for (const o of s.orders.filter(o => villages.includes(o.village))) {
    if (o.holdExpired && o.status === 'DRAFT') items.push({ type: 'order', id: o.id, village: o.village, label: '预留到期，需重新联系安排' });
    else if (o.status === 'AWAITING_CONFIRMATION') items.push({ type: 'order', id: o.id, village: o.village, label: `各方确认截止：${new Date(o.holdUntil).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}` });
    if (o.proposal && o.proposal.expires <= now) items.push({ type: 'order', id: o.id, village: o.village, label: '变更提案到期，原安排仍保留' });
    if (o.actualEnd && now >= o.actualEnd + 86400000 && ['farmer', 'main'].some(p => !['refused', 'answered'].includes(o.followup[p]?.outcome) && (o.followup[p]?.attempts || 0) < 2)) items.push({ type: 'order', id: o.id, village: o.village, label: now > o.actualEnd + 72 * 3600000 ? '回访超过建议时限，先核实意愿' : '自愿回访可开始' });
  }
  return items;
}
function summary(state, villages, now) {
  const requests = state.requests.filter(r => villages.includes(r.village)), orders = state.orders.filter(o => villages.includes(o.village));
  const due = orders.filter(o => o.firstConfirmedAt && o.initialStart <= now);
  return { environment: state.environment, label: state.environment === 'production' ? '内部协调记录，不属于项目研究或医疗效果评估' : '虚构演示数据，不属于项目研究或真实服务成果', requests: requests.length, households: new Set(requests.map(r => `${r.village}:${r.household}`)).size, notPerformed: due.filter(o => o.status === 'NOT_PERFORMED').length, unknown: due.filter(o => !['COMPLETED', 'PARTIAL', 'NOT_PERFORMED', 'CANCELLED'].includes(o.status)).length, uncontacted: orders.filter(o => o.actualEnd && !o.followup.farmer).length, confirmed: orders.filter(o => o.firstConfirmedAt).length, due: due.length, future: orders.filter(o => o.firstConfirmedAt && o.initialStart > now).length, completed: due.filter(o => o.status === 'COMPLETED').length, partial: due.filter(o => o.status === 'PARTIAL').length, cancelled: due.filter(o => o.status === 'CANCELLED').length, awaitingAcceptance: due.filter(o => o.status === 'AWAITING_ACCEPTANCE').length, completionRate: due.length ? due.filter(o => o.status === 'COMPLETED').length / due.length : null, paymentDisputes: orders.filter(o => Object.values(o.payment || {}).some(p => p.status === 'disputed')).length };
}

export function createDomain(store, clock = Date.now) {
  return {
    matches(userId, input) {
      const s = store.read(), g = grant(s, userId), r = lookup(s.requests, input.request);
      authorize(g, r.village); open(s, r.village); checkVersion(r, input.version);
      if (!['VERIFIED', 'WAITLISTED'].includes(r.status) || s.orders.some(o => o.request === r.id && o.status !== 'CANCELLED')
        || s.orders.some(o => o.household === r.household && o.village === r.village && o.firstConfirmedAt)) fail('REQUEST_NOT_AVAILABLE');
      const now = clock(), start = time(input.start), end = time(input.end);
      if (start < now || end <= start) fail('INVALID_TIME', 400);
      if (end - start > 14400000) fail('MAX_FOUR_HOURS', 400);
      if (start - now <= 3600000) fail('HOLD_DEADLINE');
      const range = { start: start - 1800000, end: end + 1800000 };
      const active = s.bookings.filter(b => b.village === r.village && (b.kind === 'confirmed' || b.expires > now));
      const occupied = [...new Set(active.map(b => b.order))].map(id => active.find(b => b.order === id));
      const capacityAvailable = halfDays(range.start, range.end).every(h => occupied.filter(b => halfDays(b.start, b.end).includes(h)).length < lookup(s.villages, r.village).capacity);
      return { request: r.id, version: r.version, village: r.village, task: r.task, start, end, checkedAt: now, capacityAvailable,
        candidates: recommendPeople(s, r, range, now) };
    },
    publicConfig() { const s = store.read(); return { environment: s.environment, updatedAt: new Date(clock()).toISOString(), program: s.program, villages: s.villages.map(v => ({ id: v.id, zh: v.zh, en: v.en, state: v.state, contact: v.contact?.approved === true && v.state === 'OPEN' && s.program === 'OPEN' ? { name: v.contact.name, phone: v.contact.phone } : null })) }; },
    snapshot(userId) {
      let s, storageReadOnly = false;
      try { s = store.transact(state => { grant(state, userId); expire(state, clock()); return state; }); }
      catch (error) { if (error.code !== 'STORAGE_READ_ONLY') throw error; s = store.read(); grant(s, userId); expire(s, clock()); storageReadOnly = true; }
      const g = grant(s, userId), stats = summary(s, g.villages, clock());
      const actor = { userId, role: g.role, villages: g.villages, ...grantCapabilities(g) };
      if (storageReadOnly) stats.storageReadOnly = true;
      if (g.role === 'analyst') return { actor, registryRevision: s.registryRevision, villages: s.villages.filter(v => g.villages.includes(v.id)), summary: stats, codedOrders: s.orders.filter(o => g.villages.includes(o.village)).map(o => ({ id: o.id, village: o.village, status: o.status, firstConfirmedAt: o.firstConfirmedAt || null })) };
      if (g.role === 'reviewer') return { actor, registryRevision: s.registryRevision, villages: s.villages.filter(v => g.villages.includes(v.id)), complaints: s.complaints.filter(c => c.reviewer === userId && !c.involved.includes(userId)) };
      if (!['admin', 'coordinator'].includes(g.role)) fail('FORBIDDEN', 403);
      return { actor, registryRevision: s.registryRevision, environment: s.environment, program: s.program, villages: s.villages.filter(v => g.villages.includes(v.id)), people: s.people.filter(p => p.villages.some(v => g.villages.includes(v))).map(p => ({ id: p.id, version: p.version, code: p.code, status: p.status, skills: p.skills, villages: p.villages.filter(v => g.villages.includes(v)), availability: p.availability, pattern: p.pattern || null })), requests: s.requests.filter(r => g.villages.includes(r.village)).map(({ name, phone, ...r }) => r), orders: s.orders.filter(o => g.villages.includes(o.village)).map(projectedOrder), bookings: s.bookings.filter(b => g.villages.includes(b.village)), summary: stats, reminders: reminders(s, g.villages, clock()), retention: g.role === 'admin' ? retentionWork(s, g.villages, clock()) : undefined, reviewers: s.grants.filter(x => x.active && x.role === 'reviewer' && x.villages.some(v => g.villages.includes(v))).map(x => ({ userId: x.userId, villages: x.villages.filter(v => g.villages.includes(v)) })), complaints: s.complaints.filter(c => g.villages.includes(c.village)), audit: g.role === 'admin' ? s.audit.filter(a => grantCapabilities(g).projectAdmin || (a.village && g.villages.includes(a.village))).slice(-100).reverse() : undefined, grants: grantCapabilities(g).projectAdmin ? s.grants.map(x => ({ userId: x.userId, role: x.role, active: x.active, villages: x.villages, ...grantCapabilities(x) })) : undefined };
    },
    print(userId, id, recipient) {
      return store.transact(s => { const g = grant(s, userId), o = lookup(s.orders, id); authorize(g, o.village); if (!['farmer', 'main', 'backup'].includes(recipient)) fail('INVALID_RECIPIENT', 400); s.audit.push({ actor: userId, at: clock(), command: 'order.print', object: o.id }); return { code: o.code, village: o.village, termsVersion: o.termsVersion, terms: o.terms, recipient, generatedAt: clock(), confirmations: Object.fromEntries(Object.entries(o.confirmations).map(([p, c]) => [p, { agree: c.agree, method: c.method, actualAt: c.actualAt }])) }; });
    },
    contact(userId, type, id) {
      return store.transact(s => { const g = grant(s, userId), order = type === 'order' ? lookup(s.orders, id) : null, obj = lookup(type === 'person' ? s.people : s.requests, order ? order.request : id); authorize(g, type === 'person' ? obj.villages.find(v => g.villages.includes(v)) : obj.village); s.audit.push({ actor: userId, at: clock(), command: 'contact.read', object: id, village: order?.village || obj.village }); return { name: obj.name, phone: obj.phone || '', ...(order ? { order: order.id, site: order.terms.site || '' } : {}) }; });
    },
    dispatch(userId, command, payload, key) {
      grant(store.read(), userId);
      if (typeof key !== 'string' || !/^[\w-]{8,128}$/.test(key)) fail('IDEMPOTENCY_REQUIRED', 400);
      const outcome = store.transact(s => {
        const now = clock(); expire(s, now);
        const checkpoint = structuredClone(s);
        try {
        const g = grant(s, userId), hash = createHash('sha256').update(JSON.stringify({ command, payload })).digest('hex'), token = `${userId}:${key}`;
        authorizeCommand(g, command, payload);
        if (s.idempotency[token]) { if (s.idempotency[token].hash !== hash) fail('IDEMPOTENCY_MISMATCH'); const previous = s.idempotency[token].result; if (g.role === 'reviewer') { const c = lookup(s.complaints, previous.id); if (c.reviewer !== userId || c.involved.includes(userId) || !g.villages.includes(c.village)) fail('FORBIDDEN', 403); } else if (previous.village) authorize(g, previous.village); if (previous.villages) previous.villages.forEach(v => authorize(g, v)); return previous; }
        let result;
        if (command === 'village.create') {
          if (payload.registryRevision !== s.registryRevision) fail('VERSION_CONFLICT');
          const names = villageNames(s, payload); text(payload.evidence, 120);
          result = { id: 'v-' + randomUUID(), ...names, state: 'PREPARING', capacity: 1, contact: null, version: 1, source: 'created', createdBy: userId, createdAt: now };
          s.villages.push(result); s.registryRevision++;
          for (const owner of s.grants.filter(x => x.active && (x.userId === userId || grantCapabilities(x).projectAdmin))) {
            owner.villages = [...new Set([...owner.villages, result.id])];
            if (owner.userId === userId && !grantCapabilities(owner).projectAdmin) owner.managedVillages = [...new Set([...(owner.managedVillages || []), result.id])];
            owner.version = grantCapabilities(owner).version + 1;
          }
          assertVillageRegistry(s, projectConfig.villages);
        } else if (command === 'person.create') {
          if (!Array.isArray(payload.villages) || !payload.villages.length || !Array.isArray(payload.skills) || !payload.skills.length || !payload.skills.every(x => taskKinds[x])) fail('INVALID_PERSON', 400);
          payload.villages.forEach(v => { authorize(g, v); lookup(s.villages, v); }); agree(payload.consent); agree(payload.verified);
          result = { id: randomUUID(), version: 1, code: `P-${s.people.length + 1}`, name: text(payload.name, 60), phone: payload.phone ? text(payload.phone, 30) : '', villages: [...new Set(payload.villages)], skills: [...new Set(payload.skills)], consent: true, status: 'ACTIVE', availability: [], pattern: normalizePattern(payload.pattern, fail), verifiedAt: now, verifiedBy: userId };
          s.people.push(result);
        } else if (command.startsWith('person.')) {
          const p = lookup(s.people, payload.id); p.villages.forEach(v => authorize(g, v)); checkVersion(p, payload.version);
          if (command === 'person.availability') { agree(payload.consent); const start = time(payload.start), end = time(payload.end); if (end <= start || end - start > 86400000 || start < now) fail('INVALID_AVAILABILITY', 400); p.availability.push({ start, end, evidence: text(payload.evidence, 120), actor: userId, enteredAt: now }); }
          else if (command === 'person.pattern') { agree(payload.consent); p.pattern = normalizePattern(payload.pattern, fail); }
          else if (command === 'person.scope') { if (!Array.isArray(payload.villages) || !payload.villages.length || !Array.isArray(payload.skills) || !payload.skills.length || !payload.skills.every(x => taskKinds[x])) fail('INVALID_PERSON', 400); payload.villages.forEach(v => { authorize(g, v); lookup(s.villages, v); }); agree(payload.consent); agree(payload.verified); p.villages = [...new Set(payload.villages)]; p.skills = [...new Set(payload.skills)]; for (const o of s.orders.filter(o => ['CONFIRMED', 'READY', 'IN_SERVICE'].includes(o.status) && [o.terms.main, o.terms.backup].includes(p.id))) o.personFollowup = true; }
          else if (command === 'person.status') { if (!['ACTIVE', 'PAUSED', 'EXITED'].includes(payload.status)) fail('INVALID_STATE', 400); p.status = payload.status; p.statusChangedAt = now; p.changeReason = text(payload.reason); for (const o of s.orders.filter(o => !['COMPLETED', 'CANCELLED', 'PARTIAL', 'NOT_PERFORMED'].includes(o.status) && [o.terms.main, o.terms.backup].includes(p.id))) o.personFollowup = true; }
          else fail('UNKNOWN_ACTION', 400);
          p.version++; result = p;
        } else if (command === 'request.create') {
          authorize(g, payload.village); open(s, payload.village); agree(payload.consent);
          if (!taskKinds[payload.task] || !['phone', 'in-person', 'paper'].includes(payload.source)) fail('INVALID_REQUEST', 400);
          const actualAt = time(payload.actualAt); if (actualAt > now || actualAt < now - 30 * 86400000) fail('INVALID_REQUEST_TIME', 400);
          result = { id: randomUUID(), version: 1, village: payload.village, household: text(payload.household, 80), name: text(payload.name, 60), phone: text(payload.phone, 30), task: payload.task, note: text(payload.note), source: payload.source, actualAt, enteredAt: now, enteredBy: userId, status: 'RECEIVED', consent: true };
          s.requests.push(result);
        } else if (command.startsWith('request.')) {
          const r = lookup(s.requests, payload.id); authorize(g, r.village); checkVersion(r, payload.version);
          if (s.orders.some(o => o.request === r.id && !['CANCELLED', 'DRAFT', 'COMPLETED', 'PARTIAL', 'NOT_PERFORMED'].includes(o.status))) fail('HAS_ACTIVE_ORDER');
          if (command === 'request.verify') { if (r.status !== 'RECEIVED') fail('INVALID_STATE'); agree(payload.scopeSafe); r.status = 'VERIFIED'; r.verifiedAt = now; r.evidence = text(payload.evidence); }
          else if (command === 'request.disposition') { if (!['WAITLISTED', 'UNMATCHED', 'OUT_OF_SCOPE', 'WITHDRAWN', 'CLOSED', 'MERGED'].includes(payload.status)) fail('INVALID_STATE', 400); r.status = payload.status; r.reason = text(payload.reason); if (['CLOSED', 'WITHDRAWN', 'UNMATCHED', 'OUT_OF_SCOPE', 'MERGED'].includes(r.status)) r.closedAt = now; if (r.status === 'WAITLISTED') r.nextContact = time(payload.nextContact); if (r.status === 'MERGED') { const target = lookup(s.requests, payload.target); authorize(g, target.village); if (target.id === r.id || target.village !== r.village) fail('INVALID_MERGE'); r.mergedInto = target.id; } }
          else fail('UNKNOWN_ACTION', 400);
          r.version++; result = r;
        } else if (command === 'order.reserve') {
          const r = lookup(s.requests, payload.request); authorize(g, r.village); open(s, r.village); checkVersion(r, payload.version);
          if (!['VERIFIED', 'WAITLISTED'].includes(r.status) || s.orders.some(o => o.request === r.id && o.status !== 'CANCELLED')) fail('REQUEST_NOT_AVAILABLE');
          if (s.orders.some(o => o.household === r.household && o.village === r.village && o.firstConfirmedAt)) fail('HOUSEHOLD_FIRST_ROUND_LIMIT');
          agree(payload.mainHoldConsent); agree(payload.backupHoldConsent); const t = terms(payload, r.task);
          const holdUntil = Math.min(now + 7200000, t.start - 3600000); if (holdUntil <= now) fail('HOLD_DEADLINE');
          const o = { id: randomUUID(), code: `F-${new Date(now).getUTCFullYear()}-${String(s.orders.length + 1).padStart(4, '0')}`, version: 1, village: r.village, household: r.household, request: r.id, status: 'AWAITING_CONFIRMATION', terms: t, termsVersion: 1, rules: { version: s.rulesVersion, capacity: lookup(s.villages, r.village).capacity }, history: [{ version: 1, terms: t, createdAt: now }], confirmations: {}, holdUntil, payment: {}, acceptance: {}, followup: {}, createdBy: userId, createdAt: now, activeProvider: t.main };
          const range = allocate(s, o, t, now); bookings(s, o, range, 'hold'); s.orders.push(o); result = o;
        } else if (command.startsWith('order.')) {
          const o = lookup(s.orders, payload.id); authorize(g, o.village); if (o.holdExpired && command === 'order.confirm') fail('HOLD_EXPIRED'); checkVersion(o, payload.version);
          if (command === 'order.confirm') {
            open(s, o.village); if (o.status !== 'AWAITING_CONFIRMATION') fail('INVALID_STATE');
            const c = confirmation(payload, now, o.termsVersion, userId); o.confirmations[c.party] = c;
            o.history.find(h => h.version === o.termsVersion).confirmations = structuredClone(o.confirmations);
            if (allAgree(o.confirmations)) { const range = allocate(s, o, o.terms, now); if (s.orders.some(x => x.id !== o.id && x.village === o.village && x.household === o.household && x.firstConfirmedAt)) fail('HOUSEHOLD_FIRST_ROUND_LIMIT'); o.status = 'CONFIRMED'; o.firstConfirmedAt = now; o.initialStart = o.terms.start; bookings(s, o, range, 'confirmed'); }
          } else if (command === 'order.propose') {
            if (o.status !== 'CONFIRMED' || o.proposal) fail('INVALID_STATE'); const t = terms(payload.terms, o.terms.task);
            o.proposal = { terms: t, version: o.termsVersion + 1, confirmations: {}, reason: text(payload.reason), createdAt: now, expires: Math.min(now + 86400000, t.start) };
          } else if (command === 'order.recheck-people') {
            open(s, o.village); if (!o.personFollowup || !['CONFIRMED', 'READY'].includes(o.status) || o.safetyPaused || o.proposal) fail('INVALID_STATE');
            for (const party of ['farmer', 'main', 'backup']) agree(payload[party]);
            allocate(s, o, o.terms, now, o.id, true); o.personFollowup = false; o.status = 'CONFIRMED'; delete o.handoff; o.peopleRecheck = { at: now, actor: userId, evidence: text(payload.evidence) };
          } else if (command === 'order.activate-backup') {
            open(s, o.village); if (!['CONFIRMED', 'READY'].includes(o.status) || o.safetyPaused || o.proposal) fail('INVALID_STATE'); agree(payload.farmer); agree(payload.backup);
            o.activeProvider = o.terms.backup; o.backupActivation = { at: now, evidence: text(payload.evidence), actor: userId };
            allocate(s, o, o.terms, now, o.id, true); o.personFollowup = false; o.status = 'CONFIRMED'; delete o.handoff;
          } else if (command === 'order.overtime') {
            if (o.status !== 'IN_SERVICE' || o.safetyPaused || !Number.isInteger(payload.minutes) || payload.minutes <= 0 || (o.extendedMinutes || 0) + payload.minutes > o.terms.overtimeMax) fail('OVERTIME_NOT_ALLOWED');
            for (const party of ['farmer', 'main', 'backup']) agree(payload[party]);
            const revised = { ...o.terms, end: o.terms.end + payload.minutes * 60000 }; const range = allocate(s, o, revised, now);
            o.terms = revised; o.termsVersion++; o.extendedMinutes = (o.extendedMinutes || 0) + payload.minutes; o.history.push({ version: o.termsVersion, terms: revised, createdAt: now, evidence: text(payload.evidence), actor: userId }); bookings(s, o, range, 'confirmed');
          } else if (command === 'order.confirm-change') {
            open(s, o.village); if (!o.proposal || o.proposal.expires <= now || o.status !== 'CONFIRMED') fail('CHANGE_EXPIRED');
            const c = confirmation(payload, now, o.proposal.version, userId); o.proposal.confirmations[c.party] = c;
            if (allAgree(o.proposal.confirmations)) { const range = allocate(s, { ...o, backupActivation: undefined }, o.proposal.terms, now); o.terms = o.proposal.terms; o.termsVersion = o.proposal.version; o.confirmations = o.proposal.confirmations; o.activeProvider = o.terms.main; delete o.backupActivation; o.history.push({ version: o.termsVersion, terms: o.terms, createdAt: now, confirmations: structuredClone(o.confirmations) }); o.rules = { version: s.rulesVersion, capacity: lookup(s.villages, o.village).capacity }; bookings(s, o, range, 'confirmed'); delete o.proposal; }
          } else if (command === 'order.reject-change') { if (!o.proposal) fail('INVALID_STATE'); o.proposalArchive = [...(o.proposalArchive || []), { ...o.proposal, endedAt: now, reason: text(payload.reason) }]; delete o.proposal;
          } else if (command === 'order.cancel') {
            if (o.actualStart) fail('ALREADY_STARTED'); if (!['DRAFT', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'READY'].includes(o.status)) fail('INVALID_STATE'); o.status = 'CANCELLED'; o.cancelReason = text(payload.reason); o.cancelledAt = now; s.bookings = s.bookings.filter(b => b.order !== o.id);
          } else if (command === 'order.handoff') {
            open(s, o.village); if (o.safetyPaused || o.status !== 'CONFIRMED' || o.proposal || o.personFollowup) fail('HANDOFF_BLOCKED');
            if (Math.floor((now + 28800000) / 86400000) !== Math.floor((o.terms.start + 28800000) / 86400000)) fail('DAY_REVIEW_REQUIRED');
            for (const field of ['weather', 'tools', 'scope', 'farmer', 'provider']) agree(payload[field]); o.handoff = { at: now, evidence: text(payload.evidence), actor: userId }; o.status = 'READY';
          } else if (command === 'order.start') {
            open(s, o.village); if (!o.handoff || o.status !== 'READY' || o.safetyPaused || o.personFollowup) fail('HANDOFF_REQUIRED');
            const actualAt = time(payload.actualAt); if (actualAt > now || actualAt < o.terms.start || actualAt > o.terms.end) fail('INVALID_START');
            allocate(s, o, o.terms, now, o.id, true); o.actualStart = actualAt; o.status = 'IN_SERVICE';
          } else if (command === 'order.safe-end') {
            if (o.status !== 'IN_SERVICE') fail('INVALID_STATE'); agree(payload.safe); const actualAt = time(payload.actualAt); if (actualAt < o.actualStart || actualAt > now) fail('INVALID_END'); o.actualEnd = actualAt; o.endEvidence = text(payload.evidence); o.status = 'AWAITING_ACCEPTANCE'; s.bookings = s.bookings.filter(b => b.order !== o.id);
          } else if (command === 'order.safety') {
            if (typeof payload.paused !== 'boolean') fail('INVALID_STATE', 400); if (!payload.paused) admin(g); o.safetyPaused = payload.paused; o.safetyReason = text(payload.reason);
          } else if (command === 'order.accept') {
            if (!o.actualEnd || !['AWAITING_ACCEPTANCE', 'COMPLETED', 'PARTIAL', 'NOT_PERFORMED'].includes(o.status)) fail('INVALID_STATE');
            if (!['farmer', 'main'].includes(payload.party) || !['complete', 'partial', 'none', 'unknown'].includes(payload.result)) fail('INVALID_ACCEPTANCE', 400);
            o.acceptance[payload.party] = { result: payload.result, evidence: text(payload.evidence), at: now, actor: userId };
            const a = o.acceptance.farmer?.result, b = o.acceptance.main?.result; o.acceptanceDispute = !!a && !!b && a !== b;
            o.status = a && a === b && a !== 'unknown' ? { complete: 'COMPLETED', partial: 'PARTIAL', none: 'NOT_PERFORMED' }[a] : 'AWAITING_ACCEPTANCE';
          } else if (command === 'order.payment') {
            if (!o.firstConfirmedAt || !['farmer', 'provider'].includes(payload.party) || !['main', 'backup'].includes(payload.recipient)) fail('INVALID_PAYMENT', 400);
            const p = o.payment[payload.recipient] ||= {}; p[payload.party] = { amount: money(payload.amount), evidence: text(payload.evidence), at: now, actor: userId };
            p.status = p.farmer?.amount != null && p.provider?.amount != null ? p.farmer.amount === p.provider.amount ? 'agreed' : 'disputed' : 'unknown';
          } else if (command === 'order.followup') {
            if (!o.actualEnd || now < o.actualEnd + 86400000 || !['farmer', 'main'].includes(payload.party)) fail('FOLLOWUP_NOT_DUE');
            const f = o.followup[payload.party] ||= { attempts: 0 }; if (f.outcome === 'refused' || f.outcome === 'answered' || f.attempts >= 2) fail('FOLLOWUP_CLOSED');
            if (!['answered', 'unreachable', 'refused'].includes(payload.outcome)) fail('INVALID_FOLLOWUP', 400);
            const answers = {}; if (payload.outcome === 'answered') { for (const q of ['timeFreed', 'extraBurden', 'feeBarrier']) { if (!['yes', 'partly', 'no', 'unknown', 'refused'].includes(payload.answers?.[q])) fail('INVALID_FOLLOWUP_ANSWER', 400); answers[q] = payload.answers[q]; } }
            o.followup[payload.party] = { attempts: f.attempts + 1, outcome: payload.outcome, answers, at: now, evidence: text(payload.evidence), actor: userId };
          } else fail('UNKNOWN_ACTION', 400);
          o.version++; result = o;
        } else if (command === 'complaint.create') {
          const o = lookup(s.orders, payload.order); authorize(g, o.village); agree(payload.consent);
          const reviewer = s.grants.find(x => x.userId === payload.reviewer && x.role === 'reviewer' && x.active && x.villages.includes(o.village));
          if (!reviewer || payload.reviewer === userId || !Array.isArray(payload.involved) || payload.involved.includes(payload.reviewer)) fail('INDEPENDENT_REVIEWER_REQUIRED');
          result = { id: randomUUID(), version: 1, village: o.village, order: o.id, code: o.code, reason: text(payload.reason), reviewer: reviewer.userId, involved: [...new Set([...payload.involved, userId])], createdBy: userId, createdAt: now, status: 'RECEIVED' }; s.complaints.push(result);
        } else if (command === 'complaint.review') {
          const c = lookup(s.complaints, payload.id); if (g.role !== 'reviewer' || c.reviewer !== userId || c.involved.includes(userId) || !g.villages.includes(c.village)) fail('INDEPENDENT_REVIEW_REQUIRED', 403);
          checkVersion(c, payload.version); c.conclusion = text(payload.conclusion); c.evidence = text(payload.evidence); c.status = 'REVIEWED'; c.reviewedAt = now; c.version++; result = c;
        } else if (command === 'settings.village') {
          const v = lookup(s.villages, payload.id); if (payload.version !== v.version) fail('VERSION_CONFLICT');
          const names = villageNames(s, payload, v.id); text(payload.evidence, 120);
          if (!['PREPARING', 'OPEN', 'PAUSED', 'CLOSED'].includes(payload.state) || !Number.isInteger(payload.capacity) || payload.capacity < 1 || payload.capacity > 10) fail('INVALID_CONFIGURATION', 400);
          Object.assign(v, names, { state: payload.state, capacity: payload.capacity, version: v.version + 1 }); s.rulesVersion++; s.registryRevision++; result = v;
        } else if (command === 'settings.program') {
          if (!['PREPARING', 'OPEN', 'PAUSED', 'CLOSED'].includes(payload.state)) fail('INVALID_CONFIGURATION', 400); s.program = payload.state; result = { state: s.program };
        } else if (command === 'grant.permissions') {
          if (payload.userId === userId) fail('CANNOT_CHANGE_SELF');
          const target = s.grants.find(x => x.userId === payload.userId) || fail('NOT_FOUND', 404), old = grantCapabilities(target);
          if (payload.version !== old.version) fail('VERSION_CONFLICT'); text(payload.evidence, 120);
          if (typeof payload.projectAdmin !== 'boolean' || typeof payload.canCreateVillages !== 'boolean' || !Array.isArray(payload.villages) || !Array.isArray(payload.managedVillages) || !payload.villages.length || new Set(payload.villages).size !== payload.villages.length || new Set(payload.managedVillages).size !== payload.managedVillages.length) fail('INVALID_PERMISSION', 400);
          if ((payload.projectAdmin && target.role !== 'admin') || ((payload.canCreateVillages || payload.managedVillages.length) && !['admin', 'coordinator'].includes(target.role)) || !payload.villages.every(v => s.villages.some(x => x.id === v)) || !payload.managedVillages.every(v => payload.villages.includes(v))) fail('INVALID_PERMISSION', 400);
          if (old.projectAdmin && target.active && !payload.projectAdmin && s.grants.filter(x => x.active && grantCapabilities(x).projectAdmin).length <= 1) fail('LAST_PROJECT_ADMIN');
          const next = { projectAdmin: payload.projectAdmin, canCreateVillages: payload.canCreateVillages, managedVillages: [...payload.managedVillages], villages: payload.projectAdmin ? s.villages.map(v => v.id) : [...payload.villages], version: old.version + 1 };
          const reduced = (old.projectAdmin && !next.projectAdmin) || (old.canCreateVillages && !next.canCreateVillages) || old.managedVillages.some(v => !next.managedVillages.includes(v)) || target.villages.some(v => !next.villages.includes(v));
          if (reduced) store.recordBoundary({ kind: 'permissions-reduced', userId: target.userId, ...next, at: now });
          Object.assign(target, next); clearSessions(store, target.userId); result = target;
        } else if (command === 'privacy.remove-contact') {
          admin(g); if (!['request', 'person'].includes(payload.type)) fail('INVALID_TYPE', 400);
          const obj = lookup(payload.type === 'request' ? s.requests : s.people, payload.id);
          if (payload.type === 'request') authorize(g, obj.village); else obj.villages.forEach(v => authorize(g, v));
          const affected = s.orders.filter(o => payload.type === 'request' ? o.request === obj.id : [o.terms.main, o.terms.backup].includes(obj.id));
          if ((payload.type === 'request' && !affected.length && !['CLOSED', 'WITHDRAWN', 'UNMATCHED', 'OUT_OF_SCOPE', 'MERGED'].includes(obj.status)) || (payload.type === 'person' && obj.status !== 'EXITED') || affected.some(o => !['COMPLETED', 'PARTIAL', 'NOT_PERFORMED', 'CANCELLED'].includes(o.status) || Object.values(o.payment || {}).some(p => p.status === 'disputed')) || s.complaints.some(c => affected.some(o => o.id === c.order) && c.status !== 'REVIEWED')) fail('RETENTION_REVIEW_REQUIRED');
          const reason = text(payload.reason); if (!store.journalConfigured) fail('RECOVERY_JOURNAL_REQUIRED');
          store.recordBoundary({ kind: 'remove-contact', type: payload.type, id: obj.id, at: now }); delete obj.name; delete obj.phone; obj.contactRemovedAt = now; obj.retentionReview = { at: now, actor: userId, reason };
          if (payload.type === 'request') for (const o of affected) { delete o.terms.site; for (const h of o.history) delete h.terms.site; if (o.proposal) delete o.proposal.terms.site; for (const p of o.proposalArchive || []) delete p.terms.site; }
          for (const token of Object.keys(s.idempotency)) { const result = s.idempotency[token].result; if (result.id === obj.id || (payload.type === 'request' && result.request === obj.id)) delete s.idempotency[token]; }
          result = { id: obj.id, village: obj.village, removed: true };
        } else if (command === 'grant.revoke') {
          if (payload.userId === userId) fail('CANNOT_REVOKE_SELF'); const target = s.grants.find(x => x.userId === payload.userId) || fail('NOT_FOUND', 404);
          if (target.active && grantCapabilities(target).projectAdmin && s.grants.filter(x => x.active && grantCapabilities(x).projectAdmin).length <= 1) fail('LAST_PROJECT_ADMIN');
          store.recordBoundary?.({ kind: 'revoke', userId: target.userId, at: now }); target.active = false; target.version = grantCapabilities(target).version + 1; delete target.recoveryId; clearSessions(store, target.userId); result = { revoked: true };
        } else fail('UNKNOWN_ACTION', 400);
        const response = JSON.parse(JSON.stringify(result));
        // Contact fields are available only through the separately authorized contact action.
        delete response.name; delete response.phone;
        s.audit.push({ at: now, actor: userId, command, object: result.id || payload.userId || 'program', village: result.village || (result.villages?.length === 1 ? result.villages[0] : undefined), ...(['village.create', 'settings.village', 'grant.permissions'].includes(command) ? { evidence: text(payload.evidence, 120), version: result.version } : {}) });
        s.idempotency[token] = { hash, result: response }; return response;
        } catch (e) {
          if (!(e instanceof ServiceError)) throw e;
          // Reject this action atomically, but retain deadline releases performed under the same lock.
          Object.assign(s, checkpoint); return { rejected: e };
        }
      });
      if (outcome?.rejected) throw outcome.rejected;
      return outcome;
    },
  };
}
