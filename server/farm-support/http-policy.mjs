import { createHash } from 'node:crypto';
import { ServiceError } from './domain.mjs';

export function createRequestPolicy({ origin, clock = Date.now }) {
  const host = new URL(origin).host, accounts = new Map();
  const interval = 15 * 60000;
  let global = { count: 0, until: 0 };
  function checkGlobalIdentityAttempt() {
    const now = clock();
    if (global.until <= now) global = { count: 0, until: now + interval };
    if (++global.count > 300) throw new ServiceError('RATE_LIMITED', 429);
  }
  function checkAccountAttempt({ email = '', identity = '' } = {}) {
    const now = clock();
    for (const [key, value] of accounts) if (value.until <= now) accounts.delete(key);
    const normalized = typeof email === 'string' && email.trim() ? email.trim().toLowerCase().slice(0, 320) : String(identity).slice(0, 512);
    if (!normalized) return;
    const key = createHash('sha256').update(normalized).digest('hex');
    let entry = accounts.get(key);
    if (!entry) {
      if (accounts.size >= 600) throw new ServiceError('RATE_LIMITED', 429);
      entry = { count: 0, until: now + interval }; accounts.set(key, entry);
    }
    if (++entry.count > 10) throw new ServiceError('RATE_LIMITED', 429);
  }
  return {
    checkGlobalIdentityAttempt,
    checkAccountAttempt,
    checkRequest(req) {
      if (req.headers.host !== host) throw new ServiceError('HOST_DENIED', 403);
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) throw new ServiceError('METHOD_DENIED', 405);
      if ((req.method === 'POST' || req.headers.origin) && req.headers.origin !== origin) throw new ServiceError('ORIGIN_DENIED', 403);
    },
    checkIdentityAttempt(input) {
      checkGlobalIdentityAttempt();
      checkAccountAttempt(input);
    },
  };
}
