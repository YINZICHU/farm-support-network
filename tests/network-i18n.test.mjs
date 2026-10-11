import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceIdentity, createPrivateViewController } from '../src/farm-support/session.js';
async function api() { const m = await import('../src/farm-support/i18n.js').catch(() => ({})); assert.equal(typeof m.translate, 'function'); return m; }
test('dictionary keys and semantic errors match in both locales', async () => {
  const { messages, translate, errorMessage, formatProjectTime } = await api();
  assert.deepEqual(Object.keys(messages.zh).sort(), Object.keys(messages.en).sort());
  assert.match(errorMessage('en', 'SIGN_IN_FAILED'), /sign in/i);
  assert.match(errorMessage('zh', 'SIGN_IN_FAILED'), /登录/);
  assert.equal(errorMessage('en', 'private-user@example.test'), errorMessage('en', 'SERVER_ERROR'));
  assert.throws(() => translate('en', 'missing-key'), /I18N_KEY_MISSING/);
  assert.match(formatProjectTime('2026-10-11T10:00:00+08:00', 'en'), /Shanghai|UTC\+08|GMT\+8/);
});
test('locale is not an auth boundary but grant changes are', () => {
  const actor = { userId: 'fictional', role: 'coordinator', villages: ['a'], projectAdmin: false, canCreateVillages: true, managedVillages: ['a'], version: 1 };
  assert.equal(workspaceIdentity(actor), workspaceIdentity({ ...actor, locale: 'en' }));
  for (const change of [{ version: 2 }, { canCreateVillages: false }, { managedVillages: [] }, { projectAdmin: true }, { villages: ['b'] }]) assert.notEqual(workspaceIdentity(actor), workspaceIdentity({ ...actor, ...change }));
});
test('late private reads are discarded after authorization change', async () => {
  let resolve, reject;
  const views = { contactValue: null, printCardValue: null, errors: [] };
  const controller = createPrivateViewController({ api: () => new Promise((a, b) => { resolve = a; reject = b; }), views: { contact: v => { views.contactValue = v; }, printCard: v => { views.printCardValue = v; } }, setBusy() {}, onError: e => views.errors.push(e) });
  const pending = controller.load('contact', '/private'); controller.clear(); resolve({ name: 'Old private name' }); await pending;
  const failure = controller.load('printCard', '/private'); controller.clear(); reject(Error('Old private failure')); await failure;
  assert.equal(views.contactValue, null); assert.equal(views.printCardValue, null); assert.deepEqual(views.errors, []);
});
