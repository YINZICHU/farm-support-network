// Runtime village facts are persisted; compiled configuration is only the seed.
const states=new Set(['PREPARING','OPEN','PAUSED','CLOSED']);
const roles=new Set(['admin','coordinator','analyst','reviewer']);
const forbiddenIds=new Set(['__proto__','constructor','prototype']);
const fail=code=>{throw Error(code);};
export function normalizeVillageName(value){
  if(typeof value!=='string'||/[\p{Cc}\p{Cf}]/u.test(value))fail('REGISTRY_NAME_INVALID');
  const name=value.trim();
  if(!name||[...name].length>80)fail('REGISTRY_NAME_INVALID');
  return name;
}
export function villageNameKey(value,locale){
  const normalized=normalizeVillageName(value).normalize('NFKC').trim();
  return locale==='en'?normalized.toLowerCase():normalized;
}
export function seedRegistry(villages,at=Date.now()){
  const result={villageRegistryVersion:1,seedVillageIds:villages.map(v=>v.id),registryRevision:1,
    villages:villages.map(v=>({...v,zh:normalizeVillageName(v.zh),en:normalizeVillageName(v.en),state:'PREPARING',capacity:1,contact:null,version:1,source:'seed',createdBy:null,createdAt:at}))};
  assertVillageRegistry(result,villages);return result;
}
export function villageLabel(villages,id,locale='zh'){
  const village=villages.find(v=>v.id===id);return village?.[locale==='en'?'en':'zh']||id;
}
export function assertVillageRegistry(state,seedVillages){
  if(state?.villageRegistryVersion===undefined)fail('REGISTRY_UPGRADE_REQUIRED');
  if(state.villageRegistryVersion!==1||!Number.isSafeInteger(state.registryRevision)||state.registryRevision<1)fail('REGISTRY_VERSION_INVALID');
  const expected=new Set(seedVillages.map(v=>v.id)),seeds=state.seedVillageIds;
  if(!Array.isArray(seeds)||seeds.length!==expected.size||new Set(seeds).size!==expected.size||!seeds.every(id=>expected.has(id)))fail('CONFIG_VILLAGE_MISMATCH');
  if(!Array.isArray(state.villages)||!seeds.every(id=>state.villages.some(v=>v?.id===id)))fail('CONFIG_VILLAGE_MISMATCH');
  const ids=new Set(),zhNames=new Set(),enNames=new Set();
  for(const v of state.villages){
    if(!v||typeof v.id!=='string'||forbiddenIds.has(v.id)||ids.has(v.id))fail('REGISTRY_VILLAGE_INVALID');
    if(expected.has(v.id)?! /^[a-z][a-z0-9-]{0,39}$/.test(v.id):! /^v-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v.id))fail('REGISTRY_VILLAGE_INVALID');
    const zh=villageNameKey(v.zh,'zh'),en=villageNameKey(v.en,'en');
    if(v.zh!==normalizeVillageName(v.zh)||v.en!==normalizeVillageName(v.en)||zhNames.has(zh)||enNames.has(en))fail('REGISTRY_NAME_DUPLICATE');
    if(!states.has(v.state)||!Number.isInteger(v.capacity)||v.capacity<1||v.capacity>10||!Number.isSafeInteger(v.version)||v.version<1)fail('REGISTRY_VILLAGE_INVALID');
    if(v.source!==(expected.has(v.id)?'seed':'created')||!Number.isSafeInteger(v.createdAt)||v.createdAt<0||(v.source==='seed'?v.createdBy!==null:typeof v.createdBy!=='string'||!v.createdBy))fail('REGISTRY_VILLAGE_INVALID');
    if(v.contact!==null&&(typeof v.contact!=='object'||Array.isArray(v.contact)))fail('REGISTRY_VILLAGE_INVALID');
    ids.add(v.id);zhNames.add(zh);enNames.add(en);
  }
  const references=list=>{
    if(!Array.isArray(list)||new Set(list).size!==list.length||!list.every(id=>ids.has(id)))fail('REGISTRY_REFERENCE_INVALID');
  };
  for(const field of ['grants','people','invitations','activationClaims','registrations']){
    for(const item of state[field]||[])if(item.villages!==undefined)references(item.villages);
  }
  for(const field of ['requests','orders','bookings','complaints']){
    for(const item of state[field]||[])if(item.village!==undefined&&!ids.has(item.village))fail('REGISTRY_REFERENCE_INVALID');
  }
  for(const g of state.grants||[]){
    if(!roles.has(g.role)||typeof g.active!=='boolean')fail('REGISTRY_GRANT_INVALID');
    references(g.villages);
    if(g.projectAdmin!==undefined&&(typeof g.projectAdmin!=='boolean'||g.projectAdmin&&g.role!=='admin'))fail('REGISTRY_GRANT_INVALID');
    if(g.canCreateVillages!==undefined&&(typeof g.canCreateVillages!=='boolean'||g.canCreateVillages&&!['admin','coordinator'].includes(g.role)))fail('REGISTRY_GRANT_INVALID');
    const managed=g.managedVillages??[];
    if(!Array.isArray(managed)||new Set(managed).size!==managed.length||!managed.every(id=>g.villages.includes(id))||managed.length&&!['admin','coordinator'].includes(g.role))fail('REGISTRY_GRANT_INVALID');
    if(g.version!==undefined&&(!Number.isSafeInteger(g.version)||g.version<1))fail('REGISTRY_GRANT_INVALID');
  }
}
