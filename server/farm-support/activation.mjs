import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { ServiceError } from './domain.mjs';
import { requestControlledPasswordReset } from './auth.mjs';
import { grantCapabilities, mayManageVillage } from '../../src/farm-support/permissions.js';

const digest = token => createHash('sha256').update(token).digest('hex');
const fail = (code, status = 409) => { throw new ServiceError(code, status); };
const pathFor = token => `/farm-support/activate/#${token}`;
const consoleAuthority = Symbol('verified offline recovery');
const isGlobal = claim => grantCapabilities(claim).projectAdmin;
export function invitationDetails(input, state) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320 || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 60 || !['admin', 'coordinator', 'reviewer', 'analyst'].includes(input.role) || !Array.isArray(input.villages) || !input.villages.length || !input.villages.every(id => state.villages.some(v => v.id === id))) fail('INVALID_INVITATION', 400);
  const projectAdmin = input.projectAdmin ?? false, canCreateVillages = input.canCreateVillages ?? false, managedVillages = input.managedVillages ?? [];
  if (typeof projectAdmin !== 'boolean' || typeof canCreateVillages !== 'boolean' || !Array.isArray(managedVillages) || !managedVillages.every(id => input.villages.includes(id)) || (projectAdmin && input.role !== 'admin') || ((canCreateVillages || managedVillages.length) && !['admin', 'coordinator'].includes(input.role))) fail('INVALID_INVITATION', 400);
  return { email, name: input.name.trim(), role: input.role, villages: [...new Set(input.villages)], projectAdmin, canCreateVillages, managedVillages: [...new Set(managedVillages)], version: 1 };
}
export function authorizeInvitation(state, actor, claim) {
  const grant = state.grants.find(g => g.userId === actor && g.active);
  if (!grant || !claim.villages.every(id => state.villages.some(v => v.id === id))) fail('FORBIDDEN', 403);
  if (grantCapabilities(grant).projectAdmin) return;
  if (claim.role !== 'coordinator' || claim.projectAdmin || claim.canCreateVillages || claim.managedVillages?.length || !claim.villages.every(id => mayManageVillage(grant, id))) fail('FORBIDDEN', 403);
}
const authorize = authorizeInvitation;
const details = invitationDetails;
function addClaim(state, input, now, extra = {}) {
  const token = randomBytes(32).toString('base64url');
  const claim = { ...details(input, state), id: randomUUID(), tokenHash: digest(token), expires: now + 86400000, status: 'ISSUED', ...extra };
  if (state.activationClaims.some(c => c.email === claim.email && !['SUPERSEDED', 'ACTIVE'].includes(c.status) && c.expires > now)) fail('INVITATION_ALREADY_EXISTS');
  state.activationClaims.push(claim);
  return { token, claim };
}
export function bootstrapAdministrator({ store, origin, handoffFile, email, name, verifiedIdentity }) {
  if (verifiedIdentity !== true) fail('IDENTITY_VERIFICATION_REQUIRED', 403);
  if (store.read().bootstrapStarted || store.read().grants.length || store.read().activationClaims.length) fail('BOOTSTRAP_ALREADY_STARTED');
  const fd = openSync(handoffFile, 'wx', 0o600);
  try {
    store.transact(state => {
      if (state.bootstrapStarted || state.grants.length || state.activationClaims.length) fail('BOOTSTRAP_ALREADY_STARTED');
      const { token } = addClaim(state, { email, name, role: 'admin', villages: state.villages.map(v => v.id), projectAdmin: true }, Date.now(), { bootstrap: true });
      state.bootstrapStarted = true;
      writeFileSync(fd, origin + pathFor(token) + '\n'); fsyncSync(fd);
    });
  } finally { closeSync(fd); }
}
export async function recoverAdministrator({ store, auth, origin, handoffFile, claimId, verifiedIdentity, resetMfa = false }) {
  if (verifiedIdentity !== true) fail('IDENTITY_VERIFICATION_REQUIRED', 403);
  const fd = openSync(handoffFile, 'wx', 0o600);
  try {
    const service = createActivationService({ store, auth, origin });
    const result = await service.recover(null, { claimId, verifiedIdentity, resetMfa }, consoleAuthority);
    writeFileSync(fd, origin + result.recoveryPath + '\n'); fsyncSync(fd);
  } finally { closeSync(fd); }
}

export function createActivationService({ store, auth, origin, clock = Date.now }) {
  const findUser = async email => (await auth.$context).adapter.findOne({ model: 'user', where: [{ field: 'email', value: email }] });
  return {
    issue(actor, input) {
      if (input.adultVerified !== true) fail('IDENTITY_VERIFICATION_REQUIRED', 403);
      return store.transact(state => {
        const normalized = details(input, state);
        authorize(state, actor, normalized);
        if (normalized.projectAdmin && input.projectAdminConfirmed !== true) fail('PROJECT_ADMIN_CONFIRMATION_REQUIRED', 400);
        const { token, claim } = addClaim(state, normalized, clock(), { issuer: actor });
        state.audit.push({ actor, command: 'activation.issued', object: claim.id, at: clock() });
        return token;
      });
    },
    async activate({ token, password }) {
      if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail('INVALID_PASSWORD', 400);
      if (typeof token !== 'string' || token.length > 128) fail('INVITATION_EXPIRED_OR_USED');
      const claim = store.transact(state => {
        const found = state.activationClaims.find(c => c.tokenHash === digest(token));
        if (!found || found.status !== 'ISSUED' || found.expires <= clock()) fail('INVITATION_EXPIRED_OR_USED');
        if (!found.bootstrap) authorize(state, found.issuer, found);
        store.recordBoundary({ kind: 'activation-consumed', id: found.id, at: clock() });
        found.status = 'CLAIMING'; return { ...found };
      });
      try {
        let user = await findUser(claim.email);
        const binding = claim.originalClaimId || claim.id;
        if (claim.targetUserId) {
          if (!user || user.id !== claim.targetUserId || user.activationClaimId !== binding) fail('IDENTITY_BINDING_MISMATCH');
          await auth.api.resetPassword({ body: { token: claim.resetToken, newPassword: password } });
          const context = await auth.$context;
          if (claim.resetMfa) await context.adapter.deleteMany({ model: 'twoFactor', where: [{ field: 'userId', value: user.id }] });
          await context.internalAdapter.updateUser(user.id, { recoveryId: claim.recoveryId, ...(claim.resetMfa ? { twoFactorEnabled: false } : {}) });
        } else {
          if (user) fail('IDENTITY_BINDING_MISMATCH');
          const created = await auth.api.createUser({ body: { email: claim.email, name: claim.name, password, role: 'user', data: { activationClaimId: binding } } });
          user = await (await auth.$context).internalAdapter.findUserById(created.user.id);
          if (!user || user.activationClaimId !== binding) fail('IDENTITY_BINDING_MISMATCH');
        }
        store.transact(state => {
          const current = state.activationClaims.find(c => c.id === claim.id);
          if (!current || current.status !== 'CLAIMING') fail('INVITATION_EXPIRED_OR_USED');
          if (!current.bootstrap) authorize(state, current.issuer, current);
          const existing = state.grants.find(g => g.userId === user.id);
          if (claim.targetUserId && existing && existing.recoveryId !== claim.recoveryId) fail('ACCOUNT_REVOKED');
          const ceiling = claim.targetUserId && existing ? existing : current;
          const capabilities = grantCapabilities(ceiling);
          const grant = { userId: user.id, role: ceiling.role, villages: capabilities.projectAdmin ? state.villages.map(v => v.id) : ceiling.villages.filter(id => state.villages.some(v => v.id === id)), ...capabilities, version: existing ? grantCapabilities(existing).version + 1 : 1, active: true };
          if (!grant.villages.length) fail('INVITATION_INVALID');
          if (existing) { Object.assign(existing, grant); delete existing.recoveryId; } else state.grants.push(grant);
          current.status = 'ACTIVE'; current.userId = user.id; delete current.resetToken;
          state.audit.push({ actor: user.id, command: 'activation.completed', object: claim.id, at: clock() });
        });
        return { activated: true, email: claim.email };
      } catch {
        store.transact(state => { const c = state.activationClaims.find(c => c.id === claim.id); if (c?.status === 'CLAIMING') c.status = 'NEEDS_RECOVERY'; });
        fail('ACTIVATION_REQUIRES_REVIEW');
      }
    },
    async recover(actor, { claimId, verifiedIdentity, resetMfa = false }, authority) {
      if (verifiedIdentity !== true) fail('IDENTITY_VERIFICATION_REQUIRED', 403);
      const initial = store.read(), claim = initial.activationClaims.find(c => c.id === claimId);
      if (!claim) fail('NOT_FOUND', 404);
      const consoleVerified = authority === consoleAuthority;
      const initialGrant = initial.grants.find(g => g.userId === claim.userId);
      const initialCeiling = initialGrant ? { ...claim, ...initialGrant } : claim;
      if (!consoleVerified) authorize(initial, actor, initialCeiling);
      if (!consoleVerified && (isGlobal(initialCeiling) || resetMfa)) fail('CONSOLE_RECOVERY_REQUIRED', 403);
      if (!['NEEDS_RECOVERY', 'CLAIMING', 'ACTIVE', 'RECOVERING', ...(consoleVerified ? ['ISSUED'] : [])].includes(claim.status)) fail('RECOVERY_NOT_AVAILABLE');
      const user = await findUser(claim.email), binding = claim.originalClaimId || claim.id;
      if (user && (user.activationClaimId !== binding || (claim.userId && claim.userId !== user.id))) fail('IDENTITY_BINDING_MISMATCH');
      if (user?.id === actor && !consoleVerified) fail('CONSOLE_RECOVERY_REQUIRED', 403);
      const previousGrant = initial.grants.find(g => g.userId === user?.id);
      if (previousGrant && !previousGrant.active && !previousGrant.recoveryId) fail('ACCOUNT_REVOKED');
      const recoveryId = randomUUID();
      store.transact(state => {
        const liveCeiling = state.grants.find(g => g.userId === user?.id) || claim;
        if (!consoleVerified) authorize(state, actor, liveCeiling);
        const current = state.activationClaims.find(c => c.id === claimId);
        if (current.status !== claim.status) fail('RECOVERY_NOT_AVAILABLE');
        const currentGrant = state.grants.find(g => g.userId === user?.id);
        if (currentGrant && !currentGrant.active && !currentGrant.recoveryId) fail('ACCOUNT_REVOKED');
        current.status = 'RECOVERING'; current.recoveryOperationId = recoveryId;
        if (user) {
          store.recordBoundary({ kind: 'credential-recovery', userId: user.id, recoveryId, at: clock() });
          for (const grant of state.grants.filter(g => g.userId === user.id)) { grant.active = false; grant.recoveryId = recoveryId; }
          store.db.prepare('DELETE FROM session WHERE userId=?').run(user.id);
          store.db.prepare('DELETE FROM verification WHERE value=?').run(user.id);
        }
      });
      const resetToken = user ? await requestControlledPasswordReset(auth, claim.email) : null;
      return store.transact(state => {
        const liveCeiling = state.grants.find(g => g.userId === user?.id) || claim;
        if (!consoleVerified) authorize(state, actor, liveCeiling);
        const old = state.activationClaims.find(c => c.id === claimId);
        if (old.status !== 'RECOVERING' || old.recoveryOperationId !== recoveryId) fail('RECOVERY_NOT_AVAILABLE');
        old.status = 'SUPERSEDED'; delete old.resetToken;
        const { token } = addClaim(state, { ...claim, role: liveCeiling.role, villages: liveCeiling.villages, ...grantCapabilities(liveCeiling) }, clock(), { issuer: actor, bootstrap: consoleVerified, originalClaimId: binding, ...(user ? { targetUserId: user.id, resetToken, recoveryId, resetMfa } : {}) });
        state.audit.push({ actor, command: 'activation.recovery-issued', object: claimId, at: clock() });
        return { recoveryPath: pathFor(token) };
      });
    },
  };
}
