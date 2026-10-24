import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1400,height:900}}),errors=[];
 page.setDefaultTimeout(8000);
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:1420'}/tests/browser/document-references.html`);
 await page.waitForFunction(()=>Boolean(window.fixture?.view));
 // Keep the trigger and neighbouring links above the viewport's preview-height clamp.
 await page.evaluate(()=>{
  window.fixture.setTarget('第一段引用\n第二段引用');
  window.fixture.set('# 入口\n\n[[b.md#L2|第二个引用]]\n\n[[b.md#L1|第一个引用]]');
 });
 const links=page.locator('#editor [data-mk-link-target]'),popup=page.getByRole('dialog',{name:'引用内容预览'});
 const first=links.nth(1),second=links.nth(0);
 const shown=async()=>{await popup.locator('.cm-content').waitFor();assert.ok((await popup.innerText()).includes('第一段引用'));};
 await first.hover();await shown();
 const trigger=await first.boundingBox();
 // Slow movement across the 8px gap must not dismiss the preview.
 await page.mouse.move(trigger.x+trigger.width/2,trigger.y+trigger.height+4);
 await page.waitForTimeout(300);
 assert.equal(await popup.isVisible(),true,'Preview disappeared while crossing the link/card gap');
 await popup.locator('.cm-content').hover();await page.waitForTimeout(600);
 await shown();
 // Quickly crossing another reference on the way to the card keeps the current preview.
 await first.hover();await shown();
 await second.hover();await page.waitForTimeout(80);
 assert.equal(await popup.isVisible(),true,'Crossing a neighbouring link must not immediately close the current card');
 await popup.locator('.cm-content').hover();await page.waitForTimeout(600);await shown();
 // Returning to the original trigger also cancels a scheduled close.
 await page.mouse.move(trigger.x+trigger.width/2,trigger.y+trigger.height+4);
 await page.waitForTimeout(60);await first.hover();await page.waitForTimeout(600);await shown();
 // Deliberately hovering another link still switches the preview.
 await second.hover();
 await page.waitForFunction(()=>document.querySelector('[data-reference-preview] .cm-content')?.textContent.includes('第二段引用'));
 await popup.getByRole('button',{name:'跳转并选中引用内容',exact:true}).click();
 await page.waitForFunction(()=>window.fixture.active==='notes/b.md'&&window.fixture.selected()==='第二段引用');
 assert.equal(await popup.count(),0);
 // Leaving both surfaces and Escape must continue to dismiss the preview.
 await page.mouse.move(0,0);
 await page.evaluate(()=>{window.fixture.restore();window.fixture.set('# 入口\n\n[[b.md#L1]]');});
 await page.locator('#editor [data-mk-link-target]').first().hover();await popup.waitFor();
 await page.mouse.move(1300,800);await popup.waitFor({state:'hidden'});
 await page.locator('#editor [data-mk-link-target]').first().hover();await popup.waitFor();
 await page.keyboard.press('Escape');await popup.waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);
 console.log('PASS: slow gap crossing, neighbouring-link transit, popup dwell, trigger re-entry, deliberate switching, header jump/selection, leave and Escape.');
}finally{await browser.close();}
