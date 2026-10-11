import test from 'node:test';
import assert from 'node:assert/strict';
import { clearPrivateWorkspace, workspaceIdentity } from '../../src/farm-support/session.js';

test('authentication boundaries clear contact, print, dialog, records and pending retries', () => {
  const state = { data: { private: true }, contact: { name: '虚构联系人' }, selected: 'order', dialog: { type: 'confirm' }, printCard: { terms: {} }, notice: '旧邀请链接', error: '旧错误' };
  const setters = Object.fromEntries(Object.keys(state).map(key => [key, value => { state[key] = value; }]));
  const retry = { current: { payload: '旧提交' } };
  clearPrivateWorkspace(setters, retry);
  assert.deepEqual(state, { data: null, contact: null, selected: null, dialog: null, printCard: null, notice: '', error: '' }); assert.equal(retry.current, null);
});
test('identity boundary includes user, current role and village scopes, regardless of scope order', () => {
  const a = { userId: 'one', role: 'admin', villages: ['example-b', 'example-a'] };
  assert.equal(workspaceIdentity(a), workspaceIdentity({ ...a, villages: ['example-a', 'example-b'] }));
  assert.notEqual(workspaceIdentity(a), workspaceIdentity({ ...a, role: 'analyst' }));
  assert.notEqual(workspaceIdentity(a), workspaceIdentity({ ...a, userId: 'two' }));
  assert.notEqual(workspaceIdentity(a), workspaceIdentity({ ...a, villages: ['example-a'] }));
});

test('pending account loading never requests a workspace and abandoned responses are discarded', async () => {
  const { loadAuthorizedWorkspace } = await import('../../src/farm-support/session.js');
  assert.equal(typeof loadAuthorizedWorkspace, 'function');
  const paths = [];
  const pending = await loadAuthorizedWorkspace(async path => { paths.push(path); return { status: 'PENDING' }; }, () => true);
  assert.deepEqual(paths, ['/account/status']); assert.equal(pending.workspace, null);
  let resolveStatus, current = true;
  const late = loadAuthorizedWorkspace(() => new Promise(ok => { resolveStatus = ok; }), () => current);
  current = false; resolveStatus({ status: 'APPROVED' });
  assert.equal(await late, null);
  const approved = await loadAuthorizedWorkspace(async path => path === '/account/status' ? { status: 'APPROVED' } : { actor: { userId: 'approved' } }, () => true);
  assert.equal(approved.workspace.actor.userId, 'approved');
});
