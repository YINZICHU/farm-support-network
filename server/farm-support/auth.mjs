import { betterAuth } from 'better-auth';
import { admin, twoFactor } from 'better-auth/plugins';
import { getMigrations } from 'better-auth/db/migration';
import { createMfaRateLimitHook } from './mfa.mjs';
import { projectConfig } from '../../src/farm-support/project-config.js';

const resetRequests = new WeakMap();
// Not routed publicly: only a verified, scoped recovery operation can request one.
export async function requestControlledPasswordReset(auth, email) {
  const pending = resetRequests.get(auth);
  if (!pending || pending.has(email)) throw Error('RECOVERY_BUSY');
  const capture = { token: null }; pending.set(email, capture);
  try {
    await auth.api.requestPasswordReset({ body: { email } });
    if (!capture.token) throw Error('RECOVERY_IDENTITY_MISSING');
    return capture.token;
  } finally { pending.delete(email); }
}
export async function createAuthentication(db, secret, origin, { production = false, runMigrations = !production, checkMfaAccount } = {}) {
  const options = { database: db, secret, baseURL: origin, basePath: '/api/farm-support/auth', trustedOrigins: [origin], emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 }, plugins: [admin()], session: { expiresIn: 28800, cookieCache: { enabled: false } }, rateLimit: { enabled: !production, window: 60, max: 30 }, advanced: { useSecureCookies: production }, logger: { disabled: true } };
  const pending = new Map();
  if (production) {
    if (checkMfaAccount) options.hooks = { before: createMfaRateLimitHook(checkMfaAccount) };
    options.plugins.push(twoFactor({ issuer: projectConfig.projectNameEn }));
    options.session.additionalFields = { mfaVerified: { type: 'boolean', defaultValue: false, input: false, returned: false } };
    options.databaseHooks = { session: { create: { before: async data => ({ data: { ...data, mfaVerified: false } }) } } };
    options.user = { additionalFields: {
      activationClaimId: { type: 'string', required: false, input: false, returned: false },
      recoveryId: { type: 'string', required: false, input: false, returned: false },
    } };
    Object.assign(options.emailAndPassword, {
      maxPasswordLength: 128, resetPasswordTokenExpiresIn: 86400, revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        const capture = pending.get(user.email);
        if (!capture) throw Error('CONTROLLED_RECOVERY_REQUIRED');
        capture.token = token;
      },
    });
  }
  if (runMigrations) { const migrations = await getMigrations(options, { throwOnUnsafe: true }); await migrations.runMigrations(); }
  const auth = betterAuth(options);
  if (production) resetRequests.set(auth, pending);
  return auth;
}
