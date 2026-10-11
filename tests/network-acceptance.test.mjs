import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNetworkPreview } from '../scripts/check-network-preview.mjs';
import { identityFixture, testPassword } from './identity-fixture.mjs';
import { createDomain } from '../server/farm-support/domain.mjs';
import { createActivationService } from '../server/farm-support/activation.mjs';
import { fixture } from './farm-support/helpers.mjs';
import { villageA } from './fixture-villages.mjs';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { temporaryClient } from './static-fixture.mjs';
import { startProductionServer } from '../server/farm-support/http.mjs';
const authRequire = createRequire(import.meta.resolve('better-auth'));
const { base32 } = await import(pathToFileURL(authRequire.resolve('@better-auth/utils/base32')));
test('bilingual network acceptance retains private and lifecycle safeguards', async t => {
  const f=await identityFixture(t), root=await f.account('root@example.test','admin',undefined,{projectAdmin:true});
  const app=await startProductionServer({...f,clientDir:temporaryClient(t)});t.after(()=>app.close());
  function client(){
    const jar=new Map();
    const call=(path,data)=>new Promise((ok,bad)=>{
      const req=request({hostname:'127.0.0.1',port:app.port,path,method:data===undefined?'GET':'POST',headers:{host:new URL(f.config.origin).host,origin:f.config.origin,'content-type':'application/json',cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')}},res=>{
        for(const raw of res.headers['set-cookie']||[]){const pair=raw.split(';')[0],n=pair.indexOf('='),name=pair.slice(0,n),value=pair.slice(n+1);if(value)jar.set(name,value);else jar.delete(name);}
        const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const text=Buffer.concat(chunks).toString();ok({status:res.statusCode,body:text.startsWith('{')?JSON.parse(text):text});});res.on('error',bad);
      });req.on('error',bad);req.end(data===undefined?undefined:JSON.stringify(data));
    });return{call};
  }
  const anonymous=client();assert.equal((await anonymous.call('/zh/tools/')).status,200);assert.equal((await anonymous.call('/api/farm-support/workspace')).status,401);
  async function enroll(email){
    const c=client();assert.equal((await c.call('/api/farm-support/auth/sign-in/email',{email,password:testPassword})).status,200);
    assert.equal((await c.call('/api/farm-support/workspace')).status,403);
    const enabled=await c.call('/api/farm-support/auth/two-factor/enable',{password:testPassword});assert.equal(enabled.status,200);
    const encoded=new URL(enabled.body.totpURI).searchParams.get('secret'),secret=new TextDecoder().decode(base32.decode(encoded));
    const {code}=await app.auth.api.generateTOTP({body:{secret}});
    assert.equal((await c.call('/api/farm-support/auth/two-factor/verify-totp',{code})).status,200);
    assert.equal((await c.call('/api/farm-support/workspace')).status,200);return c;
  }
  await enroll('root@example.test');
  const domain=createDomain(f.store), service=createActivationService({...f,origin:f.config.origin});
  const village=domain.dispatch(root,'village.create',{zh:'虚构验收村',en:'Fictional Acceptance Village',registryRevision:1,evidence:'Fictional verification'},'accept-new');
  const token=service.issue(root,{email:'manager@example.test',name:'Fictional manager',role:'coordinator',villages:[village.id],managedVillages:[village.id],adultVerified:true});
  await service.activate({token,password:testPassword});
  const manager=f.store.read().grants.at(-1);
  assert.deepEqual(manager.villages,[village.id]);assert.deepEqual(manager.managedVillages,[village.id]);assert.equal(manager.canCreateVillages,false);
  const managerClient=await enroll('manager@example.test');
  assert.deepEqual((await managerClient.call('/api/farm-support/workspace')).body.villages.map(v=>v.id),[village.id]);
  const renamed=domain.dispatch(manager.userId,'settings.village',{...village,zh:'虚构验收改名村',state:'OPEN',evidence:'Fictional renamed'},'accept-rename');assert.equal(renamed.id,village.id);
  const ordinaryToken=service.issue(manager.userId,{email:'ordinary@example.test',name:'Fictional coordinator',role:'coordinator',villages:[village.id],adultVerified:true});
  await service.activate({token:ordinaryToken,password:testPassword});const ordinary=f.store.read().grants.at(-1);
  assert.deepEqual(ordinary.villages,[village.id]);assert.deepEqual(ordinary.managedVillages,[]);assert.equal(ordinary.projectAdmin,false);
  assert.throws(()=>domain.dispatch(ordinary.userId,'settings.village',{...renamed,state:'PAUSED',evidence:'Not authorized'},'accept-denied'),/FORBIDDEN/);
  assert.deepEqual(domain.snapshot(manager.userId).villages.map(v=>v.id),[village.id]);assert.ok(domain.snapshot(root).villages.some(v=>v.id===village.id));
  assert.throws(()=>service.issue(manager.userId,{email:'outside@example.test',name:'Fictional',role:'coordinator',villages:[villageA],adultVerified:true}),/FORBIDDEN/);
  domain.dispatch(manager.userId,'settings.village',{...renamed,state:'PAUSED',evidence:'Fictional paused'},'accept-pause');
  const local=fixture();t.after(()=>local.store.db.close());let order=local.confirm(local.call('order.reserve',local.terms(local.request())));
  local.setTime('2026-10-12T09:00:00+08:00');order=local.call('order.handoff',{id:order.id,version:order.version,weather:true,tools:true,scope:true,farmer:true,provider:true,evidence:'Fictional check'});order=local.call('order.start',{id:order.id,version:order.version,actualAt:'2026-10-12T09:00:00+08:00'});
  const v=local.store.read().villages.find(v=>v.id===order.village);local.call('settings.village',{...v,state:'PAUSED',evidence:'Fictional pause'});local.setTime('2026-10-12T10:00:00+08:00');order=local.call('order.safe-end',{id:order.id,version:order.version,safe:true,actualAt:'2026-10-12T10:00:00+08:00',evidence:'Fictional safe end'},'local');assert.equal(order.status,'AWAITING_ACCEPTANCE');
  assert.equal(checkNetworkPreview({locale:'en',width:375,viewportWidth:375,scrollWidth:390,brokenLinks:[],consoleErrors:[],focusChecks:{pass:true}}).ok,false);
  assert.equal(checkNetworkPreview({locale:'zh',width:375,viewportWidth:375,scrollWidth:375,brokenLinks:[],consoleErrors:[],focusChecks:{pass:true}}).ok,true);
  assert.equal(checkNetworkPreview({locale:'zh',width:375,viewportWidth:375,scrollWidth:375,brokenLinks:['404'],consoleErrors:[],focusChecks:{pass:true}}).ok,false);
});
