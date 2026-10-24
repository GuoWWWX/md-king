import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:1420'}/tests/browser/document-references.html`);
 await page.waitForFunction(()=>Boolean(window.fixture?.view));
 const table=`# 编辑对齐\n\n| 左列标题 | 右列标题 |\n| :--- | ---: |\n| 短文本 | ${'这里的正文比较长，用于撑高表格行并检查短文本的垂直位置。'.repeat(8)} |`;
 for(const dark of [false,true]){
  await page.evaluate(({table,dark})=>{window.fixture.restore();window.fixture.configure({dark});window.fixture.set(table);},{table,dark});
  const wrapper=page.locator('#editor .mk-cm-table-wrapper');
  if(await wrapper.evaluate(e=>e.classList.contains('is-wrap')))await wrapper.locator('.mk-table-width-mode-button').click();
  const content=page.locator('#editor .mk-cm-table-cell-content[data-table-row="1"][data-table-column="0"]');
  await content.waitFor();
  for(const header of await page.locator('#editor th .mk-cm-table-cell-content').all())assert.equal(await header.evaluate(e=>getComputedStyle(e).textAlign),'center');
  await page.mouse.move(1190,890);
  const original=await content.evaluate(e=>({row:getComputedStyle(e.closest('tr')).backgroundColor,height:e.closest('tr').getBoundingClientRect().height}));
  assert.ok(original.height>60);
  await content.click();
  const input=page.locator('#editor textarea[data-table-row="1"][data-table-column="0"]');
  await input.waitFor({state:'visible'});
  const metrics=await input.evaluate(e=>{const cell=e.closest('td'),box=e.getBoundingClientRect(),outer=cell.getBoundingClientRect();return {background:getComputedStyle(e).backgroundColor,selectedBackground:getComputedStyle(cell).backgroundColor,row:getComputedStyle(cell.closest('tr')).backgroundColor,shadow:getComputedStyle(cell).boxShadow,delta:Math.abs(box.y+box.height/2-outer.y-outer.height/2),align:getComputedStyle(cell).verticalAlign};});
  assert.equal(metrics.background,'rgba(0, 0, 0, 0)');
  assert.equal(metrics.selectedBackground,'rgba(0, 0, 0, 0)');
  assert.equal(metrics.row,original.row,'Editing should not fill the tall row blue');
  assert.equal(metrics.align,'middle');
  assert.ok(metrics.delta<2,JSON.stringify(metrics));
  assert.notEqual(metrics.shadow,'none','The active cell keeps its blue border');
  await input.press('Escape');
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: light/dark tall editing cells stay transparent and vertically centred, with blue cell border and centred headers regardless of body-column alignment.');
}finally{await browser.close();}
