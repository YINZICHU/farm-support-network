import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../../src/farm-support/api.js';

test('matching query errors stay in the query and only current 401s invalidate the session', async () => {
  const originalFetch = globalThis.fetch;
  let status = 409, current = true, sessionCleared = 0;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: status === 401 ? 'LOGIN_REQUIRED' : 'STALE_VERSION' }), { status });
  try {
    const query = () => api.requestMatches({ request: 'demo', version: 2 }, () => current, () => sessionCleared++);
    await assert.rejects(query(), error => error.status === 409);
    assert.equal(sessionCleared, 0);
    status = 401;
    await assert.rejects(query(), error => error.status === 401);
    assert.equal(sessionCleared, 1);
    current = false;
    await assert.rejects(query(), error => error.status === 401);
    assert.equal(sessionCleared, 1);
    globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ code: 'P-1' }] }));
    assert.equal(await query(), undefined);
    current = true;
    assert.deepEqual(await query(), { candidates: [{ code: 'P-1' }] });
  } finally { globalThis.fetch = originalFetch; }
});

test('current delayed authorization changes clear private workspace, abandoned matching does not', async () => {
  const original=globalThis.fetch;let release,started,current=true,cleared=0;
  let ready=new Promise(resolve=>{started=resolve;});
  globalThis.fetch=()=>new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify({error:'AUTHORIZATION_CHANGED'}),{status:403}));started();});
  try{
    const query=api.requestMatches({request:'fictional',version:1},()=>current,()=>cleared++);
    await ready;release();await assert.rejects(query,/AUTHORIZATION_CHANGED/);assert.equal(cleared,1);
    ready=new Promise(resolve=>{started=resolve;});
    const abandoned=api.requestMatches({request:'fictional',version:1},()=>current,()=>cleared++);
    await ready;current=false;release();await assert.rejects(abandoned,/AUTHORIZATION_CHANGED/);assert.equal(cleared,1);
  }finally{globalThis.fetch=original;}
});
