import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {createManifest,findArtifact,verifyManifest} from '../../scripts/ci-artifacts.mjs';

const sha='a'.repeat(40),repo='example/md-king',version='1.2.3';
const baseRun={id:101,run_attempt:2,status:'completed',conclusion:'success',event:'push',head_sha:sha,head_branch:'develop',path:'.github/workflows/ci.yml',repository:{full_name:repo},head_repository:{full_name:repo}};
const artifact=(kind='checks')=>({id:202,name:`ci-${kind}-${sha}-2`,expired:false});
const fetcher=(runs,artifacts)=>async url=>({ok:true,json:async()=>url.includes('/workflows/')?{workflow_runs:runs}:{artifacts}});

test('reuse requires the exact commit, trusted push workflow, source branch and current attempt',async()=>{
  const found=await findArtifact({repo,sha,kind:'checks',fetcher:fetcher([baseRun],[artifact()])});
  assert.deepEqual(found,{run_id:'101',artifact_id:'202'});
  const wrongRuns=[{status:'in_progress'},{conclusion:'failure'},{event:'pull_request'},{head_sha:'b'.repeat(40)},{head_branch:'main'},{path:'.github/workflows/other.yml'},{repository:{full_name:'other/repo'}},{head_repository:{full_name:'fork/md-king'}}];
  for(const wrong of wrongRuns)assert.equal((await findArtifact({repo,sha,kind:'checks',fetcher:fetcher([{...baseRun,...wrong}],[artifact()])})).artifact_id,'');
  for(const artifacts of [[],[{...artifact(),expired:true}],[{...artifact(),name:`ci-checks-${sha}-1`}]])assert.equal((await findArtifact({repo,sha,kind:'checks',fetcher:fetcher([baseRun],artifacts)})).artifact_id,'');
  assert.deepEqual(await findArtifact({repo,sha,kind:'bundles',fetcher:fetcher([{...baseRun,head_branch:'main'}],[artifact('bundles')])}),found);
  assert.equal((await findArtifact({repo,sha,kind:'bundles',fetcher:fetcher([baseRun],[artifact('bundles')])})).artifact_id,'');
});

test('lookup queries the expected SHA and never treats API failures as a successful validation',async()=>{
  await findArtifact({repo,sha,kind:'bundles',fetcher:async url=>{
    const query=new URL(url).searchParams;
    assert.equal(query.get('head_sha'),sha);assert.equal(query.get('branch'),'main');
    assert.equal(query.get('status'),'success');assert.equal(query.get('event'),'push');
    return {ok:true,json:async()=>({workflow_runs:[]})};
  }});
  await assert.rejects(findArtifact({repo,sha,kind:'checks',fetcher:async()=>({ok:false,status:403})}),/HTTP 403/);
});

for(const kind of ['checks','bundles'])test(`${kind} manifest rejects stale commits, changed versions and damaged payloads`,t=>{
  const parent=resolve('.codex/release-speed-qa');mkdirSync(parent,{recursive:true});
  const root=mkdtempSync(join(parent,`${kind}-`));
  t.after(()=>{assert.ok(root.startsWith(parent+sep));rmSync(root,{recursive:true,force:true});});
  const paths=kind==='checks'?['dist/index.html','dist/assets/app.js']:[`msi/md-king_${version}_x64_en-US.msi`,`nsis/md-king_${version}_x64-setup.exe`];
  for(const path of paths){mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),`payload ${path}`);}
  const manifest=createManifest(root,kind,sha,version),file=join(root,`ci-${kind}.json`);
  writeFileSync(file,JSON.stringify(manifest));verifyManifest(root,kind,sha,version);
  assert.throws(()=>verifyManifest(root,kind,'b'.repeat(40),version));
  assert.throws(()=>verifyManifest(root,kind,sha,'1.2.4'));
  const original=readFileSync(join(root,paths[0]));writeFileSync(join(root,paths[0]),'changed');
  assert.throws(()=>verifyManifest(root,kind,sha,version));writeFileSync(join(root,paths[0]),original);
  writeFileSync(file,JSON.stringify({...manifest,files:[{path:'../outside',size:1,sha256:'f'.repeat(64)}]}));
  assert.throws(()=>verifyManifest(root,kind,sha,version));
  writeFileSync(file,JSON.stringify(manifest));rmSync(join(root,paths[0]));
  assert.throws(()=>verifyManifest(root,kind,sha,version));
});
