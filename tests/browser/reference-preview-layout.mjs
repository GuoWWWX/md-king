import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1400,height:900}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:1420'}/tests/browser/document-references.html`);
 await page.waitForFunction(()=>Boolean(window.fixture?.view));
 const popup=page.getByRole('dialog',{name:'引用内容预览'});
 async function show(content,dark=false){
  await page.mouse.move(0,0);
  await page.evaluate(({content,dark})=>{window.fixture.restore();window.fixture.configure({dark});window.fixture.setTarget(content);window.fixture.set(`# 入口\n\n[[b.md#L1-L${content.split('\n').length}]]`);},{content,dark});
  await page.locator('#editor [data-mk-link-target]').first().hover();
  await popup.waitFor();await popup.locator('.cm-content').waitFor();
  await page.waitForTimeout(100);
 }
 async function bounds(){return popup.evaluate(element=>{const scroll=element.querySelector('.cm-scroller'),content=element.querySelector('.cm-content'),last=element.querySelector('.cm-line:last-child');return {height:scroll.clientHeight,scrollHeight:scroll.scrollHeight,paddingBottom:parseFloat(getComputedStyle(content).paddingBottom),lastGap:scroll.getBoundingClientRect().bottom-last.getBoundingClientRect().bottom,popupHeight:element.getBoundingClientRect().height};});}
 for(const dark of [false,true])for(const count of [1,4,30]){
  await show(Array.from({length:count},(_,i)=>`第 ${i+1} 行引用内容。`).join('\n'),dark);
  const metrics=await bounds();
  assert.ok(metrics.paddingBottom<=16,`Reference preview must not inherit writing-space padding: ${JSON.stringify(metrics)}`);
  if(count<=4){assert.ok(metrics.scrollHeight<=metrics.height+1,`Short preview must not scroll into blank space: ${JSON.stringify(metrics)}`);assert.ok(metrics.lastGap<=20,JSON.stringify(metrics));}
  else{
   assert.ok(metrics.height<=301&&metrics.scrollHeight>metrics.height,JSON.stringify(metrics));
   await popup.locator('.cm-scroller').evaluate(element=>{element.scrollTop=element.scrollHeight;});
   await page.waitForTimeout(100);assert.ok((await bounds()).lastGap<=20,JSON.stringify(await bounds()));
  }
  const jump=popup.getByRole('button',{name:'跳转并选中引用内容',exact:true});
  assert.equal(await jump.innerText(),'','Jump control should be an icon, without a footer text row');
  assert.equal(await jump.locator('svg').count(),1);
  assert.ok(await jump.evaluate(button=>{const line=button.previousElementSibling;return line?.textContent.includes('line ')&&Math.abs(line.getBoundingClientRect().y-button.getBoundingClientRect().y)<12;}),'Jump icon must sit immediately to the right of the header line range');
  if(dark&&count===4){await mkdir('.codex/reference-preview-layout-qa',{recursive:true});await popup.screenshot({path:'.codex/reference-preview-layout-qa/short-dark.png'});}
 }
 // Debounced source updates during the 400ms hover delay must not leave a loading-only card.
 await page.mouse.move(0,0);
 await page.evaluate(()=>{window.fixture.restore();window.fixture.setTarget('同步后的目标段落');window.fixture.set('# 入口\n\n[[b.md#L1]]');});
 await page.locator('#editor [data-mk-link-target]').first().hover();
 await page.evaluate(()=>{const view=window.fixture.view;view.dispatch({changes:{from:view.state.doc.length,insert:'\n\n新增的正文'}});});
 await popup.waitFor();await popup.locator('.cm-content').waitFor();
 assert.ok((await popup.innerText()).includes('同步后的目标段落'));
 assert.equal(await popup.getByRole('button',{name:'跳转并选中引用内容',exact:true}).isDisabled(),false);
 await show('一段需要自动换行的引用内容。'.repeat(100));
 assert.ok((await bounds()).scrollHeight>(await bounds()).height,'Wrapped paragraphs must scroll at the body height limit');
 await page.setViewportSize({width:520,height:320});await page.waitForTimeout(150);await show('短预览');
 assert.ok(await popup.evaluate(element=>{const r=element.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}),'Preview should remain inside a small viewport');
 await popup.getByRole('button',{name:'跳转并选中引用内容',exact:true}).click();
 await page.waitForFunction(()=>window.fixture.active==='notes/b.md'&&window.fixture.selected()==='短预览');
 assert.deepEqual(errors,[]);
 console.log('PASS: short previews shrink without blank scroll space; long/wrapped previews scroll to text end; footer removed; header icon jumps and selects; light/dark and small viewport pass.');
}finally{await browser.close();}
