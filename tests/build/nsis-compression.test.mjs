import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {copyFileSync,linkSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';

const fixture=String.raw`
    ; Check the first radio button if this the first time
    ; we enter this page or if the second button wasn't
    ; selected the last time we were on this page
    ${'${If}'} $ReinstallPageCheck <> 2
      SendMessage $R2 ${'${BM_SETCHECK}'} ${'${BST_CHECKED}'} 0
    ${'${Else}'}
      SendMessage $R3 ${'${BM_SETCHECK}'} ${'${BST_CHECKED}'} 0
    ${'${EndIf}'}
    CreateDirectory "$INSTDIR\pandoc\windows"
    File /a "/oname=pandoc\windows\pandoc.exe" "C:\fixture\pandoc.exe"
    Delete "$INSTDIR\pandoc\windows\pandoc.exe"
  Delete "$INSTDIR\@MAIN@.exe"
  WriteUninstaller "$INSTDIR\uninstall.exe"
`.replace('@MAIN@','${MAINBINARYNAME}');

test('NSIS temporary uncompressed and legacy scripts get one final non-solid LZMA directive',{skip:process.platform!=='win32'},()=>{
  const parent=resolve('.codex/release-speed-qa');mkdirSync(parent,{recursive:true});
  const root=mkdtempSync(join(parent,'nsis-'));
  try {
    const scripts=join(root,'scripts'),nsis=join(root,'src-tauri/target/release/nsis/x64'),pandoc=join(root,'src-tauri/resources/pandoc/windows');
    for(const path of [scripts,nsis,pandoc])mkdirSync(path,{recursive:true});
    copyFileSync(resolve('scripts/patch-nsis-update-resources.ps1'),join(scripts,'patch-nsis-update-resources.ps1'));
    // Both paths stay in the same test filesystem; the read-only hardlink avoids copying the large engine.
    try{linkSync(resolve('src-tauri/resources/pandoc/windows/pandoc.exe'),join(pandoc,'pandoc.exe'));}
    catch{copyFileSync(resolve('src-tauri/resources/pandoc/windows/pandoc.exe'),join(pandoc,'pandoc.exe'));}
    const run=()=>spawnSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(scripts,'patch-nsis-update-resources.ps1')],{encoding:'utf8'});
    for(const mode of ['none','lzma','flat']) {
      const compression=mode==='flat'?'SetCompressor "lzma"':`!if "${mode}" == "none"\n  SetCompress off\n!else\n  ; Set the compression algorithm. We default to LZMA.\n  SetCompressor /SOLID "${mode}"\n!endif`;
      writeFileSync(join(nsis,'installer.nsi'),compression+fixture);
      const result=run();assert.equal(result.status,0,result.stderr||result.stdout);
      const patched=readFileSync(join(nsis,'installer.nsi'),'utf8');
      assert.equal((patched.match(/SetCompressor/g)||[]).length,1);
      assert.match(patched,/SetCompressor "lzma"/);assert.doesNotMatch(patched,/SetCompress off|\/SOLID/);
      assert.match(patched,/pandoc_version_check:/);assert.match(patched,/update-base/);
      assert.match(patched,/File \/a "\/oname=pandoc\\windows\\pandoc\.exe"/);
      assert.equal(run().status,0,'patching again remains valid');
    }
    writeFileSync(join(nsis,'installer.nsi'),'SetCompressor "zlib"'+fixture);
    assert.notEqual(run().status,0,'unknown compression must fail instead of shipping the temporary installer');
  } finally {assert.ok(root.startsWith(parent+sep));rmSync(root,{recursive:true,force:true});}
});
