import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,readdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {projectConfig} from '../src/farm-support/project-config.js';
import {openStore} from '../server/farm-support/store.mjs';
import {provisionStorage,openProductionStore} from '../server/farm-support/production-store.mjs';

async function registry() {
  const module=await import('../src/farm-support/village-registry.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
  assert.equal(typeof module.seedRegistry,'function','persistent registry seeding must exist');
  assert.equal(typeof module.assertVillageRegistry,'function','registry validation must exist');
  return module;
}
const seeds=[{id:'north',zh:'北村',en:'North Village'},{id:'south',zh:'南村',en:'South Village'}];
const dynamicId='v-01234567-89ab-4cde-8fab-0123456789ab';
const dynamic={id:dynamicId,zh:'新增村',en:'New Village',state:'PREPARING',capacity:1,contact:null,version:1,source:'created',createdBy:'actor',createdAt:1770000000000};
function hashes(dir){return Object.fromEntries(readdirSync(dir).sort().map(name=>[name,createHash('sha256').update(readFileSync(join(dir,name))).digest('hex')]));}
async function production(t){
  const dataDir=mkdtempSync(join(tmpdir(),'network-registry-test-'));
  t.after(()=>rmSync(dataDir,{recursive:true,force:true}));
  const config={dataDir,origin:'https://registry.example.test',instanceId:'fictional-registry-test',authSecret:randomBytes(48).toString('hex'),dataKey:randomBytes(32)};
  await provisionStorage(config,{verifiedMount:true});return config;
}
function state(api){return {schema:1,...api.seedRegistry(seeds,1770000000000),grants:[],people:[],requests:[],orders:[],bookings:[],complaints:[],invitations:[],activationClaims:[],registrations:[]};}

// Catches unversioned seeds and accidental opening of a newly configured village.
test('seed registry is versioned and every new village begins preparing',async()=>{
  const api=await registry(),s=state(api);
  assert.equal(s.villageRegistryVersion,1);assert.equal(s.registryRevision,1);
  assert.deepEqual(s.seedVillageIds,['north','south']);
  assert.ok(s.villages.every(v=>v.state==='PREPARING'&&v.capacity===1&&v.contact===null&&v.version===1));
  assert.equal(api.villageLabel(s.villages,'north','en'),'North Village');
  assert.equal(api.villageLabel(s.villages,'not-authorized','zh'),'not-authorized');
  api.assertVillageRegistry(s,seeds);
});

// Catches startup rejecting legitimate runtime extras or writing during a drift refusal.
test('dynamic village survives reopen but seed drift leaves storage untouched',async t=>{
  await registry();const config=await production(t);
  let store=openProductionStore(config,{verifiedMount:true});
  store.transact(s=>{s.villages.push({...dynamic});s.registryRevision++;});store.db.close();
  store=openProductionStore(config,{verifiedMount:true});
  assert.equal(store.read().villages.find(v=>v.id===dynamicId).zh,'新增村');
  store.transact(s=>{s.seedVillageIds[0]='changed-seed';});store.db.close();
  const before=hashes(config.dataDir);
  assert.throws(()=>openProductionStore(config,{verifiedMount:true}),/CONFIG_VILLAGE_MISMATCH/);
  assert.deepEqual(hashes(config.dataDir),before);
});

// Catches keeping a dangling scope or record after an incomplete registry change.
test('invalid registry references fail closed',async()=>{
  const api=await registry();
  for(const [field,item] of [
    ['grants',{userId:'actor',role:'coordinator',active:true,villages:['missing']}],
    ['people',{id:'p',villages:['missing']}],['requests',{id:'r',village:'missing'}],
    ['orders',{id:'o',village:'missing'}],['bookings',{order:'o',village:'missing'}],
    ['invitations',{id:'i',villages:['missing']}],['activationClaims',{id:'a',villages:['missing']}],
  ]){
    const s=state(api);s[field].push(item);
    assert.throws(()=>api.assertVillageRegistry(s,seeds),/REGISTRY_REFERENCE_INVALID/,field);
  }
  const s=state(api);s.grants.push({userId:'actor',role:'coordinator',active:true,villages:['north'],managedVillages:['south']});
  assert.throws(()=>api.assertVillageRegistry(s,seeds),/REGISTRY_GRANT_INVALID/);
});

// Catches malformed persisted names, illegal IDs, and corrupted registry versions.
test('invalid registry fields and normalized duplicate names refuse validation',async()=>{
  const api=await registry();
  for(const change of [
    {villageRegistryVersion:2},{registryRevision:0},{seedVillageIds:['north','north']},
    {villages:[...state(api).villages,{...dynamic,id:'../private'}]},
    {villages:[...state(api).villages,{...dynamic,en:'Ｎｏｒｔｈ Ｖｉｌｌａｇｅ'}]},
    {villages:[...state(api).villages,{...dynamic,zh:'a\nB'}]},
    {villages:[...state(api).villages,{...dynamic,capacity:11}]},
    {villages:[...state(api).villages,{...dynamic,version:0}]},
  ]) assert.throws(()=>api.assertVillageRegistry({...state(api),...change},seeds),/REGISTRY_|CONFIG_VILLAGE_MISMATCH/);
});

test('unupgraded legacy production state is refused without changing storage bytes',async t=>{
  await registry();const config=await production(t),store=openProductionStore(config,{verifiedMount:true});
  store.transact(s=>{delete s.villageRegistryVersion;delete s.seedVillageIds;delete s.registryRevision;});store.db.close();
  const before=hashes(config.dataDir);
  assert.throws(()=>openProductionStore(config,{verifiedMount:true}),/REGISTRY_UPGRADE_REQUIRED/);
  assert.deepEqual(hashes(config.dataDir),before);
});

test('ordinary store initialization uses the same registry facts as production',async()=>{
  const api=await registry(),store=openStore(':memory:',randomBytes(32));
  try{const s=store.read();api.assertVillageRegistry(s,projectConfig.villages);assert.equal(s.villageRegistryVersion,1);}
  finally{store.db.close();}
});
