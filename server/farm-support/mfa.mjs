import { ServiceError } from './domain.mjs';
import { createAuthMiddleware, getSessionFromCtx, APIError } from 'better-auth/api';
import { requiresManagementMfa } from '../../src/farm-support/permissions.js';

export function createMfaRateLimitHook(checkAccount) {
  return createAuthMiddleware(async ctx => {
    if (!ctx.path.startsWith('/two-factor/')) return;
    // Match the authentication library's principal selection. Never use raw
    // cookies, client user IDs or a new challenge ID as an account identity.
    const session = await getSessionFromCtx(ctx, { disableCookieCache: true, disableRefresh: true });
    let userId = session?.user.id;
    if (!userId) {
      const cookie = ctx.context.createAuthCookie('two_factor');
      const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
      if (identifier) {
        const pending = await ctx.context.internalAdapter.findVerificationValue(identifier);
        if (pending && new Date(pending.expiresAt).getTime() > Date.now()) {
          userId = (await ctx.context.internalAdapter.findUserById(pending.value))?.id;
        }
      }
    }
    // Unresolvable requests already consumed the HTTP global allowance.
    if (!userId) return;
    try { checkAccount(userId); }
    catch (e) {
      if (e.code === 'RATE_LIMITED') throw new APIError('TOO_MANY_REQUESTS', { message: 'RATE_LIMITED' });
      throw e;
    }
  });
}

export const productionAuthPaths = new Set(['/auth/sign-in/email', '/auth/sign-out', '/auth/two-factor/enable', '/auth/two-factor/verify-totp', '/auth/two-factor/verify-backup-code']);
export async function requirePrivilegedMfa({ session, grant, auth }) {
  if (!session || !grant?.active || grant.userId !== session.user.id) throw new ServiceError('LOGIN_REQUIRED', 401);
  if (!requiresManagementMfa(grant)) return;
  const context = await auth.$context;
  const stored = await context.adapter.findOne({ model: 'session', where: [{ field: 'id', value: session.session.id }] });
  const user = await context.internalAdapter.findUserById(session.user.id);
  if (!stored || stored.userId !== user?.id || stored.mfaVerified !== true || !user.twoFactorEnabled || new Date(stored.expiresAt).getTime() <= Date.now()) throw new ServiceError('MFA_REQUIRED', 403);
}
export async function accountSecurityStatus({ session, grant, auth }) {
  try { await requirePrivilegedMfa({ session, grant, auth }); return 'APPROVED'; }
  catch (e) {
    if (e.code !== 'MFA_REQUIRED') throw e;
    const user = await (await auth.$context).internalAdapter.findUserById(session.user.id);
    return user.twoFactorEnabled ? 'MFA_CHALLENGE_REQUIRED' : 'MFA_SETUP_REQUIRED';
  }
}
function nextCookies(headers, response) {
  const cookies = new Map((headers.get('cookie') || '').split(';').map(v => v.trim()).filter(Boolean).map(v => { const n = v.indexOf('='); return [v.slice(0, n), v.slice(n + 1)]; }));
  for (const raw of response.headers.getSetCookie()) {
    const part = raw.split(';')[0], n = part.indexOf('='), key = part.slice(0, n), value = part.slice(n + 1);
    if (value) cookies.set(key, value); else cookies.delete(key);
  }
  const next = new Headers(headers); next.set('cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; ')); return next;
}
export async function handleProductionAuth({ auth, store, origin, path, headers, input }) {
  if (!productionAuthPaths.has(path)) throw new ServiceError('NOT_FOUND', 404);
  if (path === '/auth/two-factor/enable') {
    const session = await auth.api.getSession({ headers });
    const grant = store.read().grants.find(g => g.userId === session?.user.id && g.active && requiresManagementMfa(g));
    if (!grant) throw new ServiceError('FORBIDDEN', 403);
    if (session.user.twoFactorEnabled) throw new ServiceError('MFA_ALREADY_ENABLED', 409);
    input = { password: input.password, method: 'totp' };
  }
  const verifying = ['/auth/two-factor/verify-totp', '/auth/two-factor/verify-backup-code'].includes(path);
  if (verifying) input = { code: input.code, trustDevice: false, ...(path.endsWith('verify-backup-code') ? { disableSession: false } : {}) };
  const response = await auth.handler(new Request(origin + '/api/farm-support' + path, { method: 'POST', headers, body: JSON.stringify(input) }));
  if (!response.ok) {
    const status = response.status === 429 ? 429 : 401;
    return Response.json({ error: status === 429 ? 'RATE_LIMITED' : verifying ? 'MFA_VERIFICATION_FAILED' : 'SIGN_IN_FAILED' }, { status });
  }
  const payload = await response.json();
  if (verifying) {
    // Enrollment rotates the cookie, while the library response may name the old token.
    // Authenticate the resulting cookie again instead of trusting response/client fields.
    const session = await auth.api.getSession({ headers: nextCookies(headers, response), query: { disableCookieCache: true, disableRefresh: true } });
    const grant = store.read().grants.find(g => g.userId === session?.user.id && g.active);
    if (!session || !grant || !session.user.twoFactorEnabled) throw new ServiceError('FORBIDDEN', 403);
    await (await auth.$context).adapter.update({ model: 'session', where: [{ field: 'id', value: session.session.id }], update: { mfaVerified: true } });
  }
  const safePayload = path.endsWith('/enable') ? payload : verifying ? { verified: true } : payload.twoFactorRedirect ? { twoFactorRedirect: true } : { success: true };
  return new Response(JSON.stringify(safePayload), { status: response.status, headers: response.headers });
}
