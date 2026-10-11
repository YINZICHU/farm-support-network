import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './farm-support/helpers.mjs';
const input = (f, zh = '新村', en = 'New Village') => ({ zh, en, evidence: 'Fictional authorization reference', registryRevision: f.store.read().registryRevision });

test('management audit records minimal evidence references and exact affected versions',()=>{
  const f=fixture();try{
    const created=f.call('village.create',input(f));
    assert.equal(f.store.read().audit.at(-1).evidence,'Fictional authorization reference');assert.equal(f.store.read().audit.at(-1).version,created.version);
    const edited=f.call('settings.village',{...created,state:'PAUSED',evidence:'Rule approval ref'});
    assert.equal(f.store.read().audit.at(-1).evidence,'Rule approval ref');assert.equal(f.store.read().audit.at(-1).version,edited.version);
    const changed=f.call('grant.permissions',{...f.store.read().grants[1],projectAdmin:false,canCreateVillages:true,managedVillages:[],evidence:'Permission approval ref'});
    assert.equal(f.store.read().audit.at(-1).evidence,'Permission approval ref');assert.equal(f.store.read().audit.at(-1).version,changed.version);
  }finally{f.store.db.close();}
});
test('delegated creator obtains only their new village', () => {
  const f = fixture();
  f.store.transact(s => { s.grants[1].canCreateVillages = true; s.grants.push({ userId: 'restricted', role: 'admin', active: true, villages: [...s.grants[0].villages] }); });
  const before = [...f.store.read().grants[1].villages], payload = input(f);
  const created = f.call('village.create', payload, 'local', 'village-create-key');
  assert.equal(created.state, 'PREPARING'); assert.equal(created.capacity, 1); assert.equal(created.contact, null);
  assert.match(created.id, /^v-[0-9a-f-]{36}$/);
  const s = f.store.read(); assert.deepEqual(s.grants[1].villages, [...before, created.id]);
  assert.deepEqual(s.grants[1].managedVillages, [created.id]);
  assert.ok(s.grants[0].villages.includes(created.id)); assert.ok(!s.grants[3].villages.includes(created.id));
  assert.deepEqual(f.call('village.create', payload, 'local', 'village-create-key'), created);
  assert.equal(f.domain.snapshot('local').registryRevision, 2); f.store.db.close();
});
test('revoked creator cannot retry an old successful key', () => {
  const f = fixture(); f.store.transact(s => s.grants[1].canCreateVillages = true);
  const payload = input(f), created = f.call('village.create', payload, 'local', 'revoked-create-key');
  f.store.transact(s => s.grants[1].canCreateVillages = false);
  assert.throws(() => f.call('village.create', payload, 'local', 'revoked-create-key'), /FORBIDDEN/);
  assert.ok(f.store.read().grants[1].managedVillages.includes(created.id)); f.store.db.close();
});
test('normalized duplicate names and stale revisions reject', () => {
  const f = fixture(), v = f.call('village.create', input(f, 'Farm', 'Farm'));
  assert.throws(() => f.call('village.create', input(f, 'Ｆａｒｍ', 'Other')), /VILLAGE_NAME_DUPLICATE/);
  assert.throws(() => f.call('village.create', input(f, '别村', 'ＦＡＲＭ')), /VILLAGE_NAME_DUPLICATE/);
  assert.throws(() => f.call('village.create', { ...input(f, '别村', 'Different'), registryRevision: 1 }), /VERSION_CONFLICT/);
  const edit = { ...v, zh: '改名', state: 'OPEN', evidence: 'Authorization reference' };
  const renamed = f.call('settings.village', edit); assert.equal(renamed.id, v.id);
  assert.throws(() => f.call('settings.village', edit), /VERSION_CONFLICT/);
  assert.throws(() => f.call('settings.village', { ...edit, version: renamed.version }, 'local'), /FORBIDDEN/);
  f.store.db.close();
});
test('paused village keeps safe completion available', () => {
  const f = fixture(); let o = f.confirm(f.call('order.reserve', f.terms(f.request())));
  f.setTime('2026-10-12T09:00:00+08:00');
  o = f.call('order.handoff', { id: o.id, version: o.version, weather: true, tools: true, scope: true, farmer: true, provider: true, evidence: 'Fictional check' });
  o = f.call('order.start', { id: o.id, version: o.version, actualAt: '2026-10-12T09:00:00+08:00' });
  const v = f.store.read().villages.find(v => v.id === o.village), history = o.history;
  f.call('settings.village', { ...v, state: 'PAUSED', evidence: 'Paused by operator' });
  f.setTime('2026-10-12T10:00:00+08:00');
  o = f.call('order.safe-end', { id: o.id, version: o.version, safe: true, actualAt: '2026-10-12T10:00:00+08:00', evidence: 'Safely finished' }, 'local');
  assert.deepEqual(o.history, history); assert.equal(o.status, 'AWAITING_ACCEPTANCE');
  assert.throws(() => f.request(o.village), /SERVICE_NOT_OPEN/); f.store.db.close();
});
