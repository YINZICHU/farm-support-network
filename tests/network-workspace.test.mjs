import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { translate } from '../src/farm-support/i18n.js';
import { workspaceIdentity, clearPrivateWorkspace } from '../src/farm-support/session.js';
import { projectConfig } from '../src/farm-support/project-config.js';
import { readFileSync } from 'node:fs';

test('both locales expose the complete coordinator workflow', async () => {
  const vite = await createServer({ configFile:false, plugins:[react()], logLevel:'silent', server:{middlewareMode:true} });
  try {
    const { LocaleContext } = await vite.ssrLoadModule('/src/farm-support/LocaleProvider.jsx');
    const render = (Component, props, locale) => renderToStaticMarkup(React.createElement(LocaleContext.Provider, {value:{locale,setLocale(){},t:(key,values)=>translate(locale,key,values)}}, React.createElement(Component,props)));
    const { default: Villages } = await vite.ssrLoadModule('/src/farm-support/VillageManagement.jsx');
    const actor={userId:'owner',role:'admin',projectAdmin:true,canCreateVillages:false,managedVillages:[],villages:['v-1'],version:1};
    const villages=[{id:'v-1',zh:'测试村',en:'Test village',version:1,state:'PREPARING',capacity:1}];
    const props={actor,villages,registryRevision:1,grants:[{...actor,active:true}],onCommand(){},onInvite(){}};
    assert.match(render(Villages,props,'en'), /Village management/);
    assert.match(render(Villages,props,'zh'), /村庄与权限/);
    const manager=render(Villages,{...props,actor:{...actor,role:'coordinator',projectAdmin:false,canCreateVillages:true,managedVillages:['v-1']}},'en');
    assert.doesNotMatch(manager, /Global account permissions|Project administrator/);
    const { default: Action } = await vite.ssrLoadModule('/src/farm-support/ActionDialog.jsx');
    const { default: Login } = await vite.ssrLoadModule('/src/farm-support/LoginPanel.jsx');
    const { default: Security } = await vite.ssrLoadModule('/src/farm-support/AccountSecurity.jsx');
    const object={id:'o',version:2,createdBy:'owner',villages:['v-1'],skills:['sorting'],terms:{task:'sorting',start:Date.now(),end:Date.now()+3600000,standard:'用户原文',feeMain:1250},extendedMinutes:0};
    const forms=['request','verify','disposition','person','availability','person-status','reserve','confirm','propose','confirm-change','reject-change','handoff','start','safe-end','accept','payment','followup','cancel','safety','recheck-people','remove-contact','person-scope','complaint','complaint-review','activate-backup','overtime','settings','program','invite','revoke','pattern'];
    for(const type of forms){
      const html=render(Action,{dialog:{type,object,party:'farmer'},people:[],requests:[],reviewers:[],authorizedVillages:['v-1'],villages,village:'v-1',villageConfig:villages[0],onClose(){},onSubmit(){}},'en');
      assert.match(html, /role="dialog"/);
      assert.doesNotMatch(html.replaceAll('用户原文','').replaceAll('中文',''), /[\u3400-\u9fff]/, type+' must translate fixed copy, not business input');
    }
    for(const [Component,props] of [[Login,{config:{environment:'production'}}],[Security,{state:'MFA_SETUP_REQUIRED'}],[Security,{state:'MFA_CHALLENGE_REQUIRED'}]]) {
      const html=render(Component,props,'en');
      assert.doesNotMatch(html.replaceAll(projectConfig.projectName,''),/[^>][\u3400-\u9fff]/);
      assert.match(html, /<label/);
    }
    const {default: Print}=await vite.ssrLoadModule('/src/farm-support/PrintCard.jsx');
    const print=render(Print,{card:{code:'O-1',terms:object.terms,recipient:'farmer',village:'v-1',termsVersion:2,confirmations:{},generatedAt:Date.now()},villages},'en');
    assert.match(print,/12.50/);assert.match(print,/Asia\/Shanghai/);assert.match(print,/用户原文/);
    assert.doesNotMatch(print.replaceAll('用户原文','').replaceAll('中文',''),/[\u3400-\u9fff]/);
  } finally { await vite.close(); }
});

test('modal forms expose a locale switch inside their focus boundary', async () => {
  const vite=await createServer({configFile:false,plugins:[react()],logLevel:'silent',server:{middlewareMode:true}});
  try{
    const {default:Action}=await vite.ssrLoadModule('/src/farm-support/ActionDialog.jsx');
    const html=renderToStaticMarkup(React.createElement(Action,{dialog:{type:'request'},people:[],requests:[],reviewers:[],authorizedVillages:[],villages:[],village:'fictional',onClose(){},onSubmit(){}}));
    assert.match(html, /role="dialog"[\s\S]*role="group"[\s\S]*lang="en"/);
    const management=readFileSync(new URL('../src/farm-support/VillageManagement.jsx',import.meta.url),'utf8');
    assert.match(management, /<header>[\s\S]*<LanguageSwitch\s*\/>/);
  }finally{await vite.close();}
});

test('creation form preserves fields on locale switch but clears on logout', () => {
  const actor={userId:'one',role:'coordinator',villages:['test'],managedVillages:['test'],version:1};
  let form={zh:'新村',en:'New village',evidence:'现场核实'};
  const before=form;
  if(workspaceIdentity(actor)!==workspaceIdentity({...actor,locale:'en'})) form=null;
  assert.equal(form.zh,before.zh);
  const setters=Object.fromEntries(['data','contact','selected','dialog','printCard','notice','error'].map(x=>[x,x==='dialog'?value=>{form=value;}:()=>{}]));
  clearPrivateWorkspace(setters, {current:{private:true}});
  assert.equal(form,null);
});

test('matching and print dialogs expose language controls without closing their focus boundary',async()=>{
  const vite=await createServer({configFile:false,plugins:[react()],logLevel:'silent',server:{middlewareMode:true}});
  try{
    const {default:Match}=await vite.ssrLoadModule('/src/farm-support/MatchDialog.jsx');
    const {default:Print}=await vite.ssrLoadModule('/src/farm-support/PrintCard.jsx');
    for(const [Component,props] of [[Match,{request:{village:'fictional',household:'Fictional',task:'sorting'},onClose(){}}],[Print,{card:{code:'Fictional',recipient:'farmer',village:'fictional',termsVersion:1,terms:{task:'sorting',start:0,end:1},confirmations:{},generatedAt:1},onClose(){}}]]){
      const html=renderToStaticMarkup(React.createElement(Component,props));
      assert.match(html,/role="dialog"[\s\S]*role="group"[\s\S]*lang="en"/);
    }
  }finally{await vite.close();}
});
