import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];
 page.setDefaultTimeout(8000);
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:1420'}/tests/browser/document-references.html`);
 await page.waitForFunction(()=>Boolean(window.fixture?.view));
 const source=`***[查看引用](https://example.com/${'long-markdown-reference/'.repeat(4)})***`;
 const table=`# 单元格编辑高度\n\n| 放置方式 | 内容 | 检查点 |\n| --- | --- | --- |\n| 粗斜体链接 | ${source} | 显示完整源码 |\n| 普通文本 | 短文本 | 保持紧凑 |`;
 const cell=row=>page.locator(`#editor .mk-cm-table-cell-content[data-table-row="${row}"][data-table-column="1"]`);
 const input=row=>page.locator(`#editor textarea[data-table-row="${row}"][data-table-column="1"]`);
 const rowHeight=row=>cell(row).evaluate(element=>element.closest('tr').getBoundingClientRect().height);
 const fits=async row=>{
  const metrics=await input(row).evaluate(element=>({client:element.clientHeight,scroll:element.scrollHeight,top:element.scrollTop,height:element.getBoundingClientRect().height,cell:element.closest('td,th').getBoundingClientRect().height}));
  assert.ok(metrics.scroll<=metrics.client+1,`All source lines must fit without clipping: ${JSON.stringify(metrics)}`);
  assert.equal(metrics.top,0,'First source line must remain visible');
  assert.ok(metrics.height<=metrics.cell+1,'Editing must grow the row instead of covering neighbouring rows');
 };
 for(const dark of [false,true])for(const mode of ['content','window']){
  await page.evaluate(({table,dark})=>{window.fixture.restore();window.fixture.configure({dark});window.fixture.set(table);},{table,dark});
  const wrapper=page.locator('#editor .mk-cm-table-wrapper');
  if(await wrapper.evaluate(element=>element.classList.contains('is-wrap'))!==(mode==='content'))await wrapper.locator('.mk-table-width-mode-button').click();
  await cell(1).waitFor();const compact=await rowHeight(1),other=await rowHeight(2);
  await cell(1).click({position:{x:5,y:8}});await input(1).waitFor({state:'visible'});await fits(1);
  assert.ok(await rowHeight(1)>compact+30,'Long Markdown source must expand its row on entry');
  assert.ok(Math.abs(await rowHeight(2)-other)<2,'Other rows should retain their heights');
  await page.locator('#outside').click();
  assert.ok(Math.abs(await rowHeight(1)-compact)<2,'Leaving unchanged source must restore compact rendering');
  await cell(1).click({position:{x:5,y:8}});await input(1).fill(source+'extra');await input(1).fill(source);
  await page.locator('#outside').click();
  await input(1).waitFor({state:'hidden'});
  assert.ok(Math.abs(await rowHeight(1)-compact)<2,'Reverting edits to the original source must also restore compact rendering');
  await cell(1).click({position:{x:5,y:8}});await input(1).waitFor({state:'visible'});await fits(1);
  const initialHeight=await rowHeight(1);
  await input(1).fill(source.repeat(2));await fits(1);
  assert.ok(await rowHeight(1)>initialHeight+20,'Typing/pasting longer source must expand again');
  await input(1).fill('短文本');await fits(1);
  assert.ok(await rowHeight(1)<initialHeight,'Deleting content should shrink the editing row');
  await page.locator('#outside').click();
  await page.waitForFunction(()=>window.fixture.source.includes('| 短文本 | 显示完整源码 |'));
  assert.ok(Math.abs(await rowHeight(1)-compact)<2,'Committed short content should restore compact rendering');
  await cell(2).click({position:{x:5,y:8}});await input(2).waitFor({state:'visible'});await fits(2);
  assert.ok(Math.abs(await rowHeight(2)-other)<2,'Short source must stay compact while editing');
  await input(2).fill(source);await fits(2);await input(2).press('Escape');
  await page.waitForFunction(()=>!document.querySelector('#editor textarea:not([hidden])'));
  assert.ok(Math.abs(await rowHeight(2)-other)<2,'Cancelling must restore compact row height');
  assert.equal(await cell(2).innerText(),'短文本');
  if(dark&&mode==='window'){
   await cell(2).click({position:{x:5,y:8}});await input(2).fill(source);await fits(2);
   await page.waitForTimeout(100);
   await mkdir('.codex/table-cell-height-qa',{recursive:true});
   await page.locator('#editor').screenshot({path:'.codex/table-cell-height-qa/editing-dark.png'});
  }
 }
 // The user's combined emphasis + cross-file wiki alias has a short label and longer source.
 await page.locator('#outside').click();
 const wiki='***[[引用测试资料/一个较长的目标文档名称.md#L127-L130\\|查看引用段落]]***';
 await page.evaluate(wiki=>{window.fixture.restore();window.fixture.set(`# Wiki 引用\n\n| 类型 | 内容 |\n| --- | --- |\n| 粗斜体引用 | ${wiki} |`);},wiki);
 await cell(1).focus();await cell(1).press('F2');await input(1).waitFor({state:'visible'});await fits(1);
 assert.ok((await input(1).inputValue()).includes('#L127-L130'));
 await page.locator('#outside').click();
 assert.equal(await cell(1).locator('strong em [data-mk-link-target],em strong [data-mk-link-target]').count(),1);
 assert.deepEqual(errors,[]);
 console.log('PASS: long source expands only its editing row; input grows/shrinks; unchanged/reverted/committed source and Escape restore compact rows; short text, wiki references, light/dark and both table widths pass.');
}finally{await browser.close();}
