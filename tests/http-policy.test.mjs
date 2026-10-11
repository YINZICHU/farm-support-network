import test from 'node:test';
import assert from 'node:assert/strict';
async function policy(options) {
  const module = await import('../server/farm-support/http-policy.mjs').catch(() => ({}));
  assert.equal(typeof module.createRequestPolicy, 'function', 'production HTTP policy must exist');
  return module.createRequestPolicy({ origin: 'https://farm.example.test', ...options });
}
test('request policy validates canonical host/origin and methods, never forwarding headers', async () => {
  const p = await policy(), req = { method: 'POST', headers: { host: 'farm.example.test', origin: 'https://farm.example.test' } };
  assert.doesNotThrow(() => p.checkRequest(req));
  assert.throws(() => p.checkRequest({ ...req, headers: { host: 'evil.example.test', origin: req.headers.origin, 'x-forwarded-host': req.headers.host } }), /HOST_DENIED/);
  assert.throws(() => p.checkRequest({ ...req, headers: { host: req.headers.host, origin: 'https://evil.example.test' } }), /ORIGIN_DENIED/);
  assert.throws(() => p.checkRequest({ ...req, method: 'PUT' }), /METHOD_DENIED/);
});
test('ten normalized account attempts expire after fifteen minutes, shared network is not identity', async () => {
  let now = 1000; const p = await policy({ clock: () => now });
  for (let i = 0; i < 10; i++) p.checkIdentityAttempt({ email: i % 2 ? ' OWNER@EXAMPLE.TEST ' : 'owner@example.test', headers: { 'x-forwarded-for': `spoof-${i}` } });
  assert.throws(() => p.checkIdentityAttempt({ email: 'Owner@example.test' }), /RATE_LIMITED/);
  assert.doesNotThrow(() => p.checkIdentityAttempt({ email: 'another@example.test' }));
  now += 15 * 60000;
  assert.doesNotThrow(() => p.checkIdentityAttempt({ email: 'owner@example.test' }));
});
test('global identity limit bounds rotating accounts and cannot be bypassed using proxy headers', async () => {
  let now = 100; const p = await policy({ clock: () => now });
  for (let i = 0; i < 300; i++) p.checkIdentityAttempt({ email: `user${i}@example.test`, headers: { 'x-forwarded-for': `${i}` } });
  assert.throws(() => p.checkIdentityAttempt({ email: 'fresh@example.test' }), /RATE_LIMITED/);
  now += 900000;
  assert.doesNotThrow(() => p.checkIdentityAttempt({ email: 'fresh@example.test' }));
});
