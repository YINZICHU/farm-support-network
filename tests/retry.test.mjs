import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/farm-support/api.js';
import { clearPrivateWorkspace, loadAuthorizedWorkspace } from '../src/farm-support/session.js';

test('an unreadable success response never becomes a saved result, while 401 remains an auth boundary', async () => {
  const original = globalThis.fetch;
  try {
    for (const body of ['unreadable', null, []]) {
      globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { if (body === 'unreadable') throw Error('truncated'); return body; } });
      await assert.rejects(api.requestApi('/command', { key: 'same-retry-key' }), e => e.code === 'RESPONSE_UNCONFIRMED');
    }
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => { throw Error('truncated'); } });
    await assert.rejects(api.requestApi('/workspace'), error => error.status === 401);
  } finally { globalThis.fetch = original; }
});
test('response-loss retry retains the same key, edited input gets a new immutable envelope', async () => {
  assert.equal(typeof api.prepareMutation, 'function');
  const ref = { current: null }, payload = { note: 'fictional first' };
  const first = api.prepareMutation(ref, 'request.create', payload), records = new Map();
  const server = envelope => { if (!records.has(envelope.key)) records.set(envelope.key, structuredClone(envelope.payload)); return records.get(envelope.key); };
  server(first); // The operation committed; its response was lost.
  const retry = api.prepareMutation(ref, 'request.create', { note: 'fictional first' });
  assert.equal(retry.key, first.key); server(retry); assert.equal(records.size, 1);
  payload.note = 'edited';
  const edited = api.prepareMutation(ref, 'request.create', payload);
  assert.notEqual(edited.key, first.key); assert.equal(first.payload.note, 'fictional first');
});
test('authentication boundaries clear retry/token views and discard a late private workspace response', async () => {
  let current = true, resolveWorkspace;
  const pending = loadAuthorizedWorkspace(async path => path === '/account/status' ? { status: 'APPROVED' } : new Promise(resolve => { resolveWorkspace = resolve; }), () => current);
  await Promise.resolve(); await Promise.resolve();
  const cleared = {}, retry = { current: { private: 'pending' } };
  const setters = Object.fromEntries(['data', 'contact', 'selected', 'dialog', 'printCard', 'notice', 'error'].map(k => [k, value => { cleared[k] = value; }]));
  current = false; clearPrivateWorkspace(setters, retry); resolveWorkspace({ people: ['old-user-private'] });
  assert.equal(await pending, null); assert.equal(retry.current, null);
  for (const key of ['data', 'contact', 'selected', 'dialog', 'printCard']) assert.equal(cleared[key], null);
  assert.equal(cleared.notice, ''); assert.equal(cleared.error, '');
});
