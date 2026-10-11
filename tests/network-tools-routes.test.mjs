import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveProductionClient } from '../server/farm-support/static.mjs';
import { resourceCatalog } from '../src/farm-support/resource-catalog.js';
import { inspectRelease } from '../scripts/check-release.mjs';
import { createSourceManifest } from '../scripts/source-manifest.mjs';
import { inspectGitHistory } from '../scripts/check-release.mjs';
import { execFileSync } from 'node:child_process';
function tree(t) { const root=mkdtempSync(join(tmpdir(),'network-tools-')); t.after(()=>rmSync(root,{recursive:true,force:true})); return root; }
function serve(root,url,method='GET') {
  const headers = {}; let body;
  const ok=serveProductionClient({url,method},{setHeader(k,v){headers[k.toLowerCase()]=v;},end(v){body=v;}},root);
  return {ok,headers,body};
}
test('public tools have bilingual labels but no private registry data', async t => {
  const vite=await createServer({configFile:false,plugins:[react()],logLevel:'silent',server:{middlewareMode:true}});t.after(()=>vite.close());
  const {default:Tools}=await vite.ssrLoadModule('/src/farm-support/ToolsPage.jsx');
  const en=renderToStaticMarkup(React.createElement(Tools,{locale:'en'})),zh=renderToStaticMarkup(React.createElement(Tools,{locale:'zh'}));
  assert.match(en,/Chinese original/);assert.match(en,/Yin Zichu/);assert.match(zh,/工具库/);
  for(const entry of resourceCatalog){assert.ok(en.includes(entry.title.en));assert.ok(zh.includes(entry.title.zh));assert.ok(en.includes(entry.format));}
  assert.doesNotMatch(en+zh,/api\/farm-support|userId|phonePlain|registryRevision|careinfarming@163/);
});
test('static downloads reject traversal symlinks and modified bytes', t => {
  const root=tree(t), row=resourceCatalog[0],name=row.path.replace('public/','');mkdirSync(join(root,'network-tools'));writeFileSync(join(root,'index.html'),'<html>Tools</html>');copyFileSync(row.path,join(root,name));
  for(const route of ['/zh/tools/','/en/tools/'])assert.equal(serve(root,route).ok,true);
  const got=serve(root,'/'+name);assert.equal(got.ok,true);assert.equal(got.headers['x-content-type-options'],'nosniff');assert.match(got.headers['content-disposition'],/attachment/);assert.match(got.headers['content-type'],/spreadsheetml/);assert.deepEqual(got.body,readFileSync(row.path));
  assert.equal(serve(root,'/'+name,'HEAD').body,undefined);
  for(const url of ['/network-tools/unknown.xlsx','/network-tools/%2e%2e/index.html','/network-tools/%2f'+name,'/'+name+'%00','/'+name]) {
    if(url==='/'+name)writeFileSync(join(root,name),'Fictional changed bytes');
    assert.equal(serve(root,url).ok,false,url);
  }
  assert.equal(serve(root,'/en/tools/','POST').ok,false);
  const linked=tree(t);symlinkSync(root,join(linked,'network-tools'),process.platform==='win32'?'junction':'dir');assert.equal(serve(linked,'/'+name).ok,false);
});
test('binary manifest preserves original bytes while text normalizes LF', t => {
  const root=tree(t),row=resourceCatalog[0];mkdirSync(join(root,'public/network-tools'),{recursive:true});copyFileSync(row.path,join(root,row.path));writeFileSync(join(root,'package.json'),'{}\r\n');
  assert.equal(inspectRelease({root}).ok,true);
  const manifest=createSourceManifest(root),binary=manifest.files.find(r=>r.path===row.path),text=manifest.files.find(r=>r.path==='package.json');
  assert.equal(manifest.schemaVersion,2);assert.equal(binary.normalization,'raw');assert.equal(binary.bytes,row.bytes);assert.equal(binary.sha256,row.sha256);assert.equal(text.normalization,'UTF-8 LF');assert.equal(text.bytes,3);
  writeFileSync(join(root,row.path),'Fictional changed bytes');assert.equal(inspectRelease({root}).ok,false);
  assert.throws(()=>createSourceManifest(root),/RELEASE_INPUT_DENIED/);
});
test('artifact and history require independent exact binary approval', t => {
  const root=tree(t),row=resourceCatalog[0];mkdirSync(join(root,'public/network-tools'),{recursive:true});mkdirSync(join(root,'dist/client/network-tools'),{recursive:true});copyFileSync(row.path,join(root,row.path));copyFileSync(row.path,join(root,'dist/client',row.path.replace('public/','')));writeFileSync(join(root,'dist/client/index.html'),'<html></html>');
  assert.equal(inspectRelease({root,artifactRoot:join(root,'dist/client')}).ok,true);
  const git=args=>execFileSync('git',args,{cwd:root,stdio:'pipe'});git(['init','--initial-branch=main']);writeFileSync(join(root,'.gitattributes'),'* -text\n');git(['add','.gitattributes',row.path]);
  const commit=()=>git(['-c','user.name=Fictional','-c','user.email=fixture@example.test','commit','-m','fixture only']);commit();assert.equal(inspectGitHistory(root).ok,true);
  writeFileSync(join(root,row.path),'Fictional changed document');git(['add',row.path]);commit();git(['rm',row.path]);commit();assert.equal(inspectGitHistory(root).ok,false);
  writeFileSync(join(root,'dist/client',row.path.replace('public/','')),'Fictional changed document');assert.equal(inspectRelease({root,artifactRoot:join(root,'dist/client')}).ok,false);
  mkdirSync(join(root,'public/network-tools'),{recursive:true});
  for(const name of ['unknown.xlsx','macro.xlsm','village-replication-toolkit.pptx'])writeFileSync(join(root,'public/network-tools',name),'Fictional unapproved file');
  assert.equal(inspectRelease({root}).ok,false);
});
