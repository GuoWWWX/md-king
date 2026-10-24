import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';

test('Windows build uses an uncompressed first pass and skips frontend only when an existing build is present',{skip:process.platform!=='win32'},()=>{
  const parent=resolve('.codex/release-speed-qa');mkdirSync(parent,{recursive:true});
  const root=mkdtempSync(join(parent,'wrapper-'));
  try {
    const scripts=join(root,'scripts'),bin=join(root,'bin'),capture=join(root,'capture.json');
    for(const path of [scripts,bin,join(root,'dist')])mkdirSync(path,{recursive:true});
    const wrapper=join(scripts,'build-windows.ps1');copyFileSync(resolve('scripts/build-windows.ps1'),wrapper);
    writeFileSync(join(root,'dist/index.html'),'validated frontend');
    writeFileSync(join(bin,'capture.mjs'),"import{readFileSync,writeFileSync}from'node:fs';const path=process.argv.at(-1);writeFileSync(process.env.BUILD_CAPTURE,JSON.stringify({path,config:JSON.parse(readFileSync(path,'utf8'))}));");
    // Stop before the real installer patching, while inspecting the actual temporary Tauri configuration.
    writeFileSync(join(bin,'pnpm.cmd'),`@"${process.execPath}" "%~dp0capture.mjs" %*\r\n@exit /b 9\r\n`);
    const env={...process.env,BUILD_CAPTURE:capture};
    const pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path'),originalPath=env[pathKey];delete env[pathKey];env.PATH=`${bin};${originalPath}`;
    const run=skip=>spawnSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',wrapper,...(skip?['-SkipFrontendBuild']:[])],{encoding:'utf8',env});
    for(const skip of [false,true]) {
      const result=run(skip);assert.notEqual(result.status,0,'failed native build must stop packaging');
      const recorded=JSON.parse(readFileSync(capture,'utf8'));
      assert.equal(recorded.config.bundle.windows.nsis.compression,'none');
      assert.equal(recorded.config.build?.beforeBuildCommand,skip?'':undefined);
      assert.equal(existsSync(recorded.path),false,'temporary configuration is cleaned after build failure');
    }
    rmSync(capture);rmSync(join(root,'dist/index.html'));
    assert.notEqual(run(true).status,0);assert.equal(existsSync(capture),false,'missing frontend must fail before running Tauri');
  } finally {assert.ok(root.startsWith(parent+sep));rmSync(root,{recursive:true,force:true});}
});
