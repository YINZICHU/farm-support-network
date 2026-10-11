import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=name=>readFileSync(new URL(`../src/farm-support/${name}.jsx`,import.meta.url),'utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;

test('actual invitation and management submit handlers preserve failed input and close only on issuance',async()=>{
  const body=source('Workspace').match(/async function invite\(payload\) \{([\s\S]*?)\n  (?:async )?function /)?.[1];
  assert.ok(body,'production invitation handler');
  let fail=true,closed=0,error=null;const epoch={current:1};
  const invite=new AsyncFunction('sessionEpoch','setBusy','requestApi','setNotice','setDialog','handleError','window','payload',body.slice(0,body.lastIndexOf('}')));
  const onInvite=payload=>invite(epoch,()=>{},async()=>{if(fail)throw Object.assign(Error('NETWORK_UNCONFIRMED'),{code:'NETWORK_UNCONFIRMED'});return {activationPath:'/fictional'};},()=>{},()=>closed++,()=>{}, {location:{origin:'https://fictional.example.test'}},payload);
  const submitBody=source('VillageManagement').match(/async function submit\(event\)\{([\s\S]*?)\n  \}\n  const scopes/)[1];
  class Form {constructor(fields){this.fields=fields;}get(k){return this.fields[k];}getAll(k){return Array.isArray(this.fields[k])?this.fields[k]:[];}}
  const submit=new AsyncFunction('setError','FormData','dialog','root','onCommand','onInvite','onClose','semanticError','event',submitBody);
  const fields={name:'Fictional draft',email:'draft@example.test',villages:['fictional'],adultVerified:'on',role:'coordinator'};
  const run=()=>submit(value=>{error=value;},Form,{type:'invite'},true,()=>{},onInvite,()=>closed++,e=>({code:e.code}),{preventDefault(){},currentTarget:fields});
  await run();assert.equal(closed,0);assert.equal(error.code,'NETWORK_UNCONFIRMED');assert.equal(fields.name,'Fictional draft');
  fail=false;await run();assert.ok(closed>0);assert.equal(error,null);
});

test('actual ActionDialog mount listener uses current close guard during pending saves',()=>{
  const text=source('ActionDialog');
  const hookBody=text.slice(text.indexOf('  const panel = useRef'),text.indexOf('  const titles ='));
  const refs=[],effects=[];let cursor=0,closed=0,handler;
  const document={activeElement:{focus(){}},addEventListener(_,fn){handler=fn;},removeEventListener(){}};
  const useRef=value=>refs[cursor++]??(refs[cursor-1]={current:value});
  let mounted=false;
  const useEffect=fn=>{if(!mounted)effects.push(fn);};
  const render=new Function('useRef','useEffect','document','d','onClose',hookBody);
  render(useRef,useEffect,document,{},()=>closed++);
  refs[0].current={querySelector(){return {focus(){}};},querySelectorAll(){return [];}};
  for(const effect of effects)effect();mounted=true;cursor=0;
  let busy=true;
  render(useRef,useEffect,document,{},()=>{if(!busy)closed++;});
  handler({key:'Escape',preventDefault(){}});assert.equal(closed,0);
  busy=false;handler({key:'Escape',preventDefault(){}});assert.equal(closed,1);
});
