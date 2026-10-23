import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1700,height:1100}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:1420'}/tests/browser/document-references.html`);
 await page.waitForFunction(()=>Boolean(window.fixture?.view));
 const reset=async()=>{await page.evaluate(()=>window.fixture.reset());await page.waitForFunction(()=>window.fixture.active==='notes/a.md');await page.waitForTimeout(150);};
 const target=range=>page.locator(`#editor [data-mk-link-target="${range}"]`);
 // All rich text containers retain working links, including rendered table widgets.
 const contexts=[
  ['#editor .cm-line', 'b.md#目标章节'],
  ['#editor .cm-line', 'b.md#^rule'],
  ['#editor .cm-line', 'b.md#L3-L4'],
  ['#editor .mk-cm-table', 'b.md#L3-L4'],
  ['#editor .mk-cm-table', 'b.md#^rule'],
 ];
 for(const dark of [false,true])for(const reading of [false,true]){
  await page.evaluate(config=>window.fixture.configure(config),{dark,reading});
  for(const [container,link] of contexts){
   await reset();
   const element=page.locator(`${container} [data-mk-link-target="${link}"]`).first();
   await element.hover();
   await page.getByRole('dialog',{name:'引用内容预览'}).waitFor();
   await page.waitForFunction(()=>document.querySelector('[data-reference-preview]')?.textContent.includes('未保存段落第一行'));
   await element.click();
   await page.waitForFunction(()=>window.fixture.active==='notes/b.md'&&window.fixture.selected().includes('未保存段落第二行'));
   const selected=await page.evaluate(()=>window.fixture.selected());
   assert.ok(selected.startsWith(link.includes('目标章节')?'# 目标章节':'未保存段落第一行'));
   assert.ok(!selected.includes('其他章节'));
   assert.deepEqual(await page.evaluate(()=>window.fixture.readRequests),[],'unsaved tabs should avoid disk reads');
  }
 }
 // Individually verify bold, italic, combined formatting, quote and Callout references.
 await page.evaluate(()=>window.fixture.configure({dark:false,reading:false}));await reset();
 const richLinks=await target('b.md#L3-L4').count();
 assert.ok(richLinks>=5,'body italic/combined, Callout, and table links all render');
 for(let index=0;index<richLinks;index++){
  await reset();await target('b.md#L3-L4').nth(index).click();
  await page.waitForFunction(()=>window.fixture.active==='notes/b.md'&&window.fixture.selected().startsWith('未保存段落第一行'));
 }
 await reset();await target('#^local').click();
 await page.waitForFunction(()=>window.fixture.selected()==='本地段落');
 assert.equal(await page.evaluate(()=>window.fixture.active),'notes/a.md');
 // Copy menu dispatches anchors to the real editor, clipboard uses native IPC.
 for(const kind of ['章节','段落','行范围']){
  await reset();
  await page.evaluate(()=>{const v=window.fixture.view;const line=v.state.doc.line(3);v.dispatch({selection:{anchor:line.from,head:line.to}});});
  await page.locator('#editor .cm-content').click({button:'right',position:{x:120,y:90}});
  await page.getByRole('menuitem',{name:`复制${kind}引用`,exact:true}).click();
  await page.waitForFunction(()=>window.fixture.clipboard.startsWith('[[/notes/a.md#'));
  const copied=await page.evaluate(()=>window.fixture.clipboard);
  if(kind==='行范围')assert.match(copied,/\|@line\]\]$/);
  const loaded=await page.evaluate(async()=>window.fixture.load(window.fixture.clipboard.slice(2,-2).split('|')[0]));
  assert.ok(loaded.range.endLine>=loaded.range.startLine);
 }
 // Dynamic stable labels follow inserted lines; code examples remain literal.
 await page.evaluate(()=>window.fixture.set('甲<!--md-king:range one:start-->\n乙<!--md-king:range one:end-->\n\n[[#^one|@line]]\n\n```md\n[[#^one|@line]]\n```'));
 await page.waitForFunction(()=>document.querySelector('#editor [data-mk-auto-line]')?.textContent.includes('line 1-2'));
 assert.equal(await page.locator('#editor [data-mk-auto-line]').count(),1);
 await page.evaluate(()=>{window.fixture.view.dispatch({changes:{from:0,insert:'新增\n'}});});
 await page.waitForFunction(()=>document.querySelector('#editor [data-mk-auto-line]')?.textContent.includes('line 2-3'));
 await page.evaluate(()=>window.fixture.preview());
 await page.waitForFunction(()=>document.querySelector('#preview [data-mk-auto-line]')?.textContent.includes('line 2-3'));
 await page.locator('#editor [data-mk-auto-line]').hover();
 await page.getByRole('dialog',{name:'引用内容预览'}).waitFor();
 await page.getByRole('button',{name:'跳转并选中引用内容',exact:true}).click();
 await page.waitForFunction(()=>window.fixture.selected().includes('乙'));
 await page.evaluate(()=>window.fixture.set('# 失效引用\n\n[[missing.md#L2]]'));
 await target('missing.md#L2').hover();
 await page.getByRole('dialog',{name:'引用内容预览'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('[data-reference-preview]')?.textContent.includes('未找到引用文档'));
 await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'引用内容预览'}).waitFor({state:'detached'});
 await mkdir('.codex/document-references-qa',{recursive:true});
 await page.evaluate(()=>window.fixture.restore());await target('b.md#^rule').first().hover();await page.getByRole('dialog',{name:'引用内容预览'}).waitFor();
 await page.screenshot({path:'.codex/document-references-qa/hover-preview.png'});
 // Exercise the production page/store wiring, beyond the isolated editor fixture.
 await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:1420'}/`);
 await page.waitForTimeout(700);
 await page.evaluate(async()=>{
  const {useDocumentTabsStore}=await import('/src/stores/document-tabs-store.ts');
  const {useAppStore}=await import('/src/stores/app-store.ts');
  const {EditorView}=await import('/node_modules/@codemirror/view/dist/index.js');
  const store=useDocumentTabsStore.getState();store.closeAllTabs();
  const destination=store.openVaultTab({path:'target.md',absolutePath:'D:/reference-qa/target.md',title:'target.md',content:'# 目标\n\n旧内容 ^rule',eol:'crlf',hasBom:true,modifiedMs:123});
  store.updateTabContent(destination,'# 目标\n\n尚未保存的新内容 ^rule');
  store.openVaultTab({path:'source.md',absolutePath:'D:/reference-qa/source.md',title:'source.md',content:'# 入口\n\n***[[target.md#^rule]]***\n\n[[#入口]]'});
  useAppStore.getState().setActivePage('convert');
  window.appFixture={store:useDocumentTabsStore,selected(){const element=document.querySelector('.mk-cm-host .cm-editor');const view=element?EditorView.findFromDOM(element):null;return view?.state.doc.sliceString(view.state.selection.main.from,view.state.selection.main.to);}};
 });
 const appLink=page.locator('.mk-cm-host [data-mk-link-target="target.md#^rule"]');
 await appLink.hover();await page.getByRole('dialog',{name:'引用内容预览'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('[data-reference-preview]')?.textContent.includes('尚未保存的新内容'));
 await appLink.click();
 await page.waitForFunction(()=>window.appFixture.selected()==='尚未保存的新内容');
 assert.deepEqual(await page.evaluate(()=>{const store=window.appFixture.store.getState();const tab=store.tabs.find(tab=>tab.id===store.activeTabId);return {path:tab.path,dirty:tab.dirty,eol:tab.eol,hasBom:tab.hasBom,modifiedMs:tab.modifiedMs};}),{path:'target.md',dirty:true,eol:'crlf',hasBom:true,modifiedMs:123});
 await page.screenshot({path:'.codex/document-references-qa/app-selected-reference.png'});
 assert.deepEqual(errors,[]);
 console.log('PASS: references in body/table/quote/Callout and emphasis combinations, light/dark/read-only, unsaved cross-file content, real target selection, native copy menus, stable current-line labels, Word preview, code literals and missing-reference errors.');
}finally{await browser.close();}
