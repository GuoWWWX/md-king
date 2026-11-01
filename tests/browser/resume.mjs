import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1100,height:1300}}), errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:1420'}/tests/browser/resume.html`);
 await page.waitForFunction(()=>{const image=document.querySelector('#preview table img');return image?.complete && image.naturalWidth>0;});
 const result=await page.evaluate(()=>{
  const paper=document.querySelector('#preview .mk-word-preview-page');
  const image=paper.querySelector('table img');
  const rect=image.getBoundingClientRect(), paperRect=paper.getBoundingClientRect();
  const scale=paperRect.width/paper.offsetWidth;
  return {pages:document.querySelectorAll('#preview .mk-word-preview-page').length, width:rect.width/scale, height:rect.height/scale,
   photoX:rect.left, paperX:paperRect.left, paperWidth:paperRect.width, text:paper.innerText,
   contactWhitespace:getComputedStyle(paper.querySelector('table th')).whiteSpace,
   border:getComputedStyle(image.closest('table')).borderTopStyle};
 });
 assert.equal(result.pages,1,'sample resume should fit on one A4 page');
 assert.ok(Math.abs(result.width-96*2.5/2.54)<1,JSON.stringify(result));
 assert.ok(Math.abs(result.height-96*3.5/2.54)<1,JSON.stringify(result));
 assert.ok(result.photoX>result.paperX+result.paperWidth*0.65,'portrait should appear on the right');
 assert.ok(result.text.includes('工作经历') && result.text.includes('项目经历'));
 assert.equal(result.contactWhitespace,'pre-wrap','contact details must preserve line breaks');
 assert.doesNotMatch(result.text,/\{width=/);
 assert.equal(result.border,'none');
 if(process.env.RESUME_SCREENSHOT) await page.locator('#preview .mk-word-preview-page').screenshot({path:process.env.RESUME_SCREENSHOT});
 await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:1420'}/tests/browser/table-images.html`);
 await page.waitForFunction(()=>window.fixture?.view);
 const source='| 姓名 | ![](assets/existing.png){width=2.5cm height=3.5cm} |\n| --- | ---: |\n';
 await page.evaluate(source=>{const v=window.fixture.view;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:source},selection:{anchor:source.length}})},source);
 await page.waitForFunction(()=>document.querySelector('#editor .mk-cm-table img')?.naturalWidth>0);
 const editorImage=await page.locator('#editor .mk-cm-table img').evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}));
 assert.ok(Math.abs(editorImage.width-96*2.5/2.54)<1);
 assert.ok(Math.abs(editorImage.height-96*3.5/2.54)<1);
 assert.doesNotMatch(await page.locator('#editor .mk-cm-table').innerText(),/\{width=/);
 await page.locator('#editor .mk-cm-table-cell-content[data-table-row="0"][data-table-column="1"]').click();
 const photoInput=page.locator('#editor textarea[data-table-row="0"][data-table-column="1"]');
 await photoInput.evaluate(el=>el.setSelectionRange(0,'![](assets/existing.png)'.length));
 await page.evaluate(()=>window.fixture.paste(0,1));
 await page.waitForFunction(()=>window.fixture.source.includes('![粘贴图片 1](assets/pasted-1.png){width=2.5cm height=3.5cm}'));
 assert.deepEqual(errors,[]);
 console.log('PASS: resume preview fits one page, includes a 25 x 35 mm portrait on the right, and hides the layout-table border.');
} finally {await browser.close();}
