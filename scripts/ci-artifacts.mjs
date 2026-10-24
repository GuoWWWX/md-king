import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {appendFileSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const kinds={checks:{branch:'develop',manifest:'ci-checks.json'},bundles:{branch:'main',manifest:'ci-bundles.json'}};
const artifactName=(kind,sha,attempt)=>`ci-${kind}-${sha}-${attempt}`;
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

function payloadPaths(root,kind,version) {
  if(kind==='bundles')return [`msi/md-king_${version}_x64_en-US.msi`,`nsis/md-king_${version}_x64-setup.exe`];
  const walk=directory=>readdirSync(join(root,directory),{withFileTypes:true}).flatMap(entry=>{
    assert.ok(!entry.isSymbolicLink(),'Artifact payload must not contain symbolic links');
    const path=`${directory}/${entry.name}`;
    return entry.isDirectory()?walk(path):[path];
  });
  const paths=walk('dist').sort();
  assert.ok(paths.includes('dist/index.html'),'Frontend entry point is missing');
  return paths;
}

export function createManifest(root,kind,sha,version) {
  assert.ok(kinds[kind],'Unknown artifact kind');
  assert.match(sha,/^[a-f0-9]{40}$/);
  assert.match(version,/^\d+\.\d+\.\d+$/);
  return {kind,sha,version,files:payloadPaths(root,kind,version).map(path=>{
    const bytes=readFileSync(join(root,path));
    assert.ok(bytes.length>0,`Empty artifact payload: ${path}`);
    return {path,size:bytes.length,sha256:sha256(bytes)};
  })};
}

export function verifyManifest(root,kind,sha,version) {
  const recorded=JSON.parse(readFileSync(join(root,kinds[kind].manifest),'utf8'));
  const actual=createManifest(root,kind,sha,version);
  // Recreate the paths ourselves, so downloaded metadata cannot select files outside the payload.
  assert.deepEqual(recorded,actual,'Artifact commit, version or file hashes do not match');
}

export async function findArtifact({repo,sha,kind,token,fetcher=fetch}) {
  assert.ok(kinds[kind],'Unknown artifact kind');
  assert.match(repo,/^[\w.-]+\/[\w.-]+$/);
  assert.match(sha,/^[a-f0-9]{40}$/);
  const api=async path=>{
    const response=await fetcher(`https://api.github.com/repos/${repo}/${path}`,{headers:{
      Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28',
    }});
    if(!response.ok)throw new Error(`GitHub artifact lookup failed: HTTP ${response.status}`);
    return response.json();
  };
  const branch=kinds[kind].branch;
  const query=new URLSearchParams({branch,event:'push',head_sha:sha,status:'success',per_page:'20'});
  const {workflow_runs:runs}=await api(`actions/workflows/ci.yml/runs?${query}`);
  for(const run of runs) {
    if(run.status!=='completed'||run.conclusion!=='success'||run.event!=='push'
      ||run.head_sha!==sha||run.head_branch!==branch||run.path!=='.github/workflows/ci.yml'
      ||run.repository?.full_name!==repo||run.head_repository?.full_name!==repo)continue;
    const {artifacts}=await api(`actions/runs/${run.id}/artifacts?per_page=100`);
    const artifact=artifacts.find(item=>!item.expired&&item.name===artifactName(kind,sha,run.run_attempt));
    if(artifact)return {run_id:String(run.id),artifact_id:String(artifact.id)};
  }
  return {run_id:'',artifact_id:''};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [command,kind]=process.argv.slice(2);
  assert.ok(kinds[kind],'Usage: ci-artifacts.mjs find|create|verify checks|bundles');
  const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  if(command==='find') {
    const found=await findArtifact({repo:process.env.GITHUB_REPOSITORY,sha,kind,token:process.env.GH_TOKEN});
    assert.ok(process.env.GITHUB_OUTPUT,'GITHUB_OUTPUT is required');
    appendFileSync(process.env.GITHUB_OUTPUT,Object.entries(found).map(([key,value])=>`${key}=${value}\n`).join(''));
    console.log(found.artifact_id?`Reusing ${kind} from successful CI run ${found.run_id} for ${sha}`:`No reusable ${kind} for ${sha}; run the full validation/build`);
  } else {
    const version=JSON.parse(readFileSync('package.json','utf8')).version;
    const root=kind==='checks'?process.cwd():resolve('src-tauri/target/release/bundle');
    if(command==='create') {
      writeFileSync(join(root,kinds[kind].manifest),JSON.stringify(createManifest(root,kind,sha,version),null,2)+'\n');
      if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`version=${version}\n`);
    }
    else {assert.equal(command,'verify');verifyManifest(root,kind,sha,version);}
    console.log(`${command}: ${kind} verified for ${sha}, version ${version}`);
  }
}
