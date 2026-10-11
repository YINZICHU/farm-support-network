import test from 'node:test';
import assert from 'node:assert/strict';
import * as session from '../src/farm-support/session.js';

function fixture() {
  assert.equal(typeof session.createPrivateViewController, 'function');
  const pending = [], state = { contact: null, printCard: null, busy: false, errors: [] };
  const controller = session.createPrivateViewController({
    api: path => new Promise((resolve, reject) => pending.push({ path, resolve, reject })),
    views: { contact: value => { state.contact = value; }, printCard: value => { state.printCard = value; } },
    setBusy: value => { state.busy = value; }, onError: e => state.errors.push(e.message),
  });
  return { pending, state, controller };
}

for (const kind of ['contact', 'printCard']) {
  test(`${kind}: a late older response cannot overwrite the latest record/recipient`, async () => {
    const f = fixture(), a = f.controller.load(kind, '/A'), b = f.controller.load(kind, '/B');
    f.pending[1].resolve({ id: 'B' }); await b;
    f.pending[0].resolve({ id: 'A' }); assert.equal(await a, undefined);
    assert.deepEqual(f.state[kind], { id: 'B' }); assert.equal(f.state.busy, false);
  });
  test(`${kind}: obsolete failure cannot clear a newer loading state or report an error`, async () => {
    const f = fixture(), a = f.controller.load(kind, '/A'), b = f.controller.load(kind, '/B');
    f.pending[0].reject(Error('old request')); assert.equal(await a, undefined);
    assert.equal(f.state.busy, true); assert.deepEqual(f.state.errors, []);
    f.pending[1].resolve({ id: 'B' }); await b; assert.equal(f.state.busy, false);
  });
  for (const boundary of ['village', 'page', 'selected', 'dialog', 'matching-time', 'close', 'logout']) {
    test(`${kind}: ${boundary} clears synchronously and discards a pending response`, async () => {
      const f = fixture(), read = f.controller.load(kind, '/A');
      f.controller.change(value => {
        assert.equal(value, 'new-context');
        assert.equal(f.state.contact, null); assert.equal(f.state.printCard, null); assert.equal(f.state.busy, false);
      }, 'new-context');
      f.pending[0].resolve({ id: 'A' }); assert.equal(await read, undefined);
      assert.equal(f.state[kind], null);
    });
  }
}

test('unmount abandons reads; only a current failure is surfaced', async () => {
  const f = fixture(), pending = f.controller.load('contact', '/A');
  f.controller.abandon(); f.pending[0].resolve({ id: 'A' }); assert.equal(await pending, undefined);
  assert.equal(f.state.contact, null);
  const latest = f.controller.load('contact', '/B');
  f.pending[1].reject(Error('current request'));
  assert.equal((await latest).error.message, 'current request');
  assert.deepEqual(f.state.errors, ['current request']); assert.equal(f.state.busy, false);
});
