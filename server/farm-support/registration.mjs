import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ServiceError } from './domain.mjs';
import { serviceVillages } from '../../src/farm-support/model.js';

const digest = token => createHash('sha256').update(token).digest('hex');
const fail = (code, status = 409) => { throw new ServiceError(code, status); };
const emailAddress = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validVillages = (ids, allowEmpty = false) => Array.isArray(ids) && (allowEmpty || ids.length > 0) && ids.length <= serviceVillages.length && new Set(ids).size === ids.length && ids.every(id => serviceVillages.some(v => v.id === id));
const blockedByStore = new WeakMap();

export function canReviewRegistration(grant, application) {
  if (!grant?.active || grant.role !== 'admin' || !Array.isArray(grant.villages)) return false;
  // A free-text request is not an existing village scope. Only the project-wide
  // administrator can review it; an empty configured list never means everyone.
  if (application.requestedOtherVillage) return serviceVillages.every(v => grant.villages.includes(v.id)) && application.requestedVillages.every(id => grant.villages.includes(id));
  return application.requestedVillages.length > 0 && application.requestedVillages.every(id => grant.villages.includes(id));
}

export function createRegistrationService({ store, auth, mailer, origin, now = Date.now }) {
  const base = new URL(origin).origin;
  if (!blockedByStore.has(store)) blockedByStore.set(store, new Set());
  const blockedTokens = blockedByStore.get(store);
  const userByEmail = email => store.db.prepare('SELECT id FROM user WHERE email = ? COLLATE NOCASE').get(email);
  const block = (r, kind) => {
    blockedTokens.add(r.tokenHash);
    store.recordBoundary({ kind, id: r.id, tokenHash: r.tokenHash, at: now() });
  };
  function administrator(s, actorId) {
    const g = s.grants.find(g => g.userId === actorId && g.active && g.role === 'admin');
    if (!g) fail('FORBIDDEN', 403);
    return g;
  }
  return {
    async request(input) {
      if (!mailer?.enabled) fail('REGISTRATION_UNAVAILABLE', 503);
      const email = emailAddress(input.email), name = typeof input.name === 'string' ? input.name.trim() : '';
      const otherVillage = input.otherVillage === undefined ? '' : typeof input.otherVillage === 'string' ? input.otherVillage.trim() : null;
      if (!validVillages(input.villages, true) || otherVillage === null || otherVillage.length > 80 || /[\u0000-\u001f\u007f]/.test(otherVillage) || (!input.villages.length && !otherVillage)) fail('INVALID_REGISTRATION', 400);
      if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || name.length > 60 || input.consent !== true) fail('INVALID_REGISTRATION', 400);
      const token = randomBytes(32).toString('base64url'), tokenHash = digest(token);
      const application = store.transact(s => {
        let r = s.registrations.find(r => r.email === email);
        if (userByEmail(email) || (r && (r.userId || r.status === 'PROVISIONING'))) return null;
        if (r?.tokenHash) block(r, 'registration-token-invalidated');
        if (!r) { r = { id: randomUUID(), version: 0 }; s.registrations.push(r); }
        Object.assign(r, { email, name, requestedVillages: [...input.villages], requestedOtherVillage: otherVillage, status: 'UNVERIFIED', userId: null, emailVerifiedAt: null, tokenHash, expiresAt: now() + 30 * 60000, claimed: false, used: false, sendStatus: 'SENDING', createdAt: r.createdAt ?? now(), consentAt: now(), version: r.version + 1 });
        return { ...r };
      });
      try {
        await mailer.send({ to: email, template: application ? 'verify' : 'account-exists', ...(application ? { verificationUrl: `${base}/farm-support/register/verify/#token=${token}` } : {}) });
        if (application) store.transact(s => { const r = s.registrations.find(r => r.id === application.id); if (r.tokenHash === tokenHash) r.sendStatus = 'SENT'; });
      } catch {
        if (application) store.transact(s => { const r = s.registrations.find(r => r.id === application.id); if (r.tokenHash === tokenHash) { block(r, 'registration-token-invalidated'); r.used = true; r.sendStatus = 'FAILED'; r.status = 'FAILED'; r.version++; } });
        fail('REGISTRATION_MAIL_FAILED', 503);
      }
      return { accepted: true };
    },
    async complete({ token, password }) {
      if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail('INVALID_REGISTRATION_PASSWORD', 400);
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail('REGISTRATION_LINK_INVALID');
      const tokenHash = digest(token);
      if (blockedTokens.has(tokenHash)) fail('REGISTRATION_LINK_INVALID');
      const application = store.transact(s => {
        const r = s.registrations.find(r => r.tokenHash === tokenHash);
        if (!r || r.claimed || r.used || r.expiresAt <= now() || r.status !== 'UNVERIFIED' || r.sendStatus !== 'SENT' || userByEmail(r.email)) fail('REGISTRATION_LINK_INVALID');
        block(r, 'registration-token-consumed');
        r.claimed = true; r.used = true; r.status = 'PROVISIONING'; r.version++;
        return { ...r };
      });
      try {
        const created = await auth.api.createUser({ body: { email: application.email, name: application.name, password, role: 'user', data: { emailVerified: true } } });
        store.transact(s => {
          const r = s.registrations.find(r => r.id === application.id);
          if (r.status !== 'PROVISIONING' || r.tokenHash !== tokenHash) fail('REGISTRATION_LINK_INVALID');
          r.userId = created.user.id; r.emailVerifiedAt = now(); r.status = 'PENDING'; r.version++;
          s.audit.push({ actor: created.user.id, command: 'registration.verified', object: r.id, at: now() });
        });
      } catch {
        store.transact(s => { const r = s.registrations.find(r => r.id === application.id); r.status = 'FAILED'; r.version++; });
        fail('REGISTRATION_SETUP_FAILED', 503);
      }
      return { status: 'PENDING' };
    },
    ownStatus(userId) {
      const s = store.read(), g = s.grants.find(g => g.userId === userId), r = s.registrations.find(r => r.userId === userId);
      return { userId, status: g ? (g.active ? 'APPROVED' : 'DISABLED') : r?.status || 'NO_ACCESS', requestedVillages: r?.requestedVillages || [], ...(r?.requestedOtherVillage ? { requestedOtherVillage: r.requestedOtherVillage } : {}) };
    },
    list(actorId) {
      const s = store.read(), g = administrator(s, actorId);
      return s.registrations.filter(r => r.emailVerifiedAt != null && r.userId && canReviewRegistration(g, r)).map(r => ({ id: r.id, userId: r.userId, email: r.email, name: r.name, requestedVillages: r.requestedVillages, ...(r.requestedOtherVillage ? { requestedOtherVillage: r.requestedOtherVillage } : {}), status: r.status, version: r.version, emailVerifiedAt: r.emailVerifiedAt }));
    },
    async review(actorId, input) {
      const result = store.transact(s => {
        const g = administrator(s, actorId), r = s.registrations.find(r => r.id === input.id);
        if (!r || !canReviewRegistration(g, r)) fail('FORBIDDEN', 403);
        if (r.version !== input.version) fail('STALE_VERSION');
        if (r.status !== 'PENDING' || !r.userId || r.emailVerifiedAt == null) fail('REGISTRATION_NOT_PENDING');
        if (input.adultVerified !== true || !['approve', 'reject'].includes(input.decision)) fail('FORBIDDEN', 403);
        if (input.decision === 'approve') {
          if (!['coordinator', 'analyst', 'reviewer'].includes(input.role) || !validVillages(input.villages) || !input.villages.every(id => g.villages.includes(id))) fail('FORBIDDEN', 403);
          if (s.grants.some(x => x.userId === r.userId)) fail('REGISTRATION_NOT_PENDING');
          s.grants.push({ userId: r.userId, role: input.role, villages: [...input.villages], active: true });
          r.status = 'APPROVED';
        } else r.status = 'REJECTED';
        r.version++; r.reviewedBy = actorId; r.reviewedAt = now();
        s.audit.push({ actor: actorId, command: `registration.${input.decision}`, object: r.id, at: now(), villages: input.decision === 'approve' ? [...input.villages] : [] });
        // A pending cookie cannot silently become an authorized session.
        store.db.prepare('DELETE FROM session WHERE userId=?').run(r.userId);
        return { status: r.status };
      });
      return result;
    },
  };
}
