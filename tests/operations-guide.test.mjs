import test from 'node:test';
import assert from 'node:assert/strict';

test('role-aware guide never asks for backup keys or cookies', async () => {
  const { operationsGuide }=await import('../src/farm-support/operations-guide.js');
  const root=operationsGuide('en',{role:'admin',projectAdmin:true});
  const manager=operationsGuide('en',{role:'coordinator',managedVillages:['a'],canCreateVillages:true});
  const ordinary=operationsGuide('zh',{role:'coordinator'});
  assert.ok(root.some(x=>x.id==='recovery'));
  assert.ok(manager.some(x=>x.id==='villages'));
  assert.ok(!manager.some(x=>x.id==='global-permissions'));
  assert.ok(!ordinary.some(x=>x.id==='villages'));
  assert.match(JSON.stringify(root),/three files|3 files/i);
  assert.match(JSON.stringify(root),/isolated|separate directory/i);
  assert.doesNotMatch(JSON.stringify(root),/<input[^>]*name="(?:backupKey|dataKey|cookie)"|we guarantee unlimited capacity|upload CSV files/i);
  assert.match(JSON.stringify(root),/manual|manually/i);
});

test('backup guide names the actual three exported artifacts in both locales', async()=>{
  const {operationsGuide}=await import('../src/farm-support/operations-guide.js');
  for(const locale of ['zh','en']){
    const text=JSON.stringify(operationsGuide(locale,{role:'admin',projectAdmin:true}));
    for(const extension of ['.bundle','.boundary','.receipt.json'])assert.ok(text.includes(extension),`${locale} guide must name ${extension}`);
  }
});
