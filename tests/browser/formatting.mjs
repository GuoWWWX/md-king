import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1550,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:1420'}/tests/browser/formatting.html`);
 await page.locator('#editor .mk-signature').waitFor();
 for(const dark of [false,true]) {
  await page.evaluate(d=>window.fixture.setTheme(d),dark);
  for(const region of ['#editor','#preview']) {
   const red=page.locator(region).getByText('红色粗斜体',{exact:true});
   assert.equal(await red.evaluate(e=>getComputedStyle(e).color),'rgb(211, 47, 47)',`${region} dark=${dark}`);
   assert.equal(await page.locator(region).getByText('红色网页',{exact:true}).evaluate(e=>getComputedStyle(e).color),'rgb(211, 47, 47)',`${region} link dark=${dark}`);
   const center=page.locator(region).getByText('普通居中',{exact:true});
   assert.equal(await center.evaluate(e=>getComputedStyle(e.closest('.cm-line,p')||e).textAlign),'center');
   const note=page.locator(region).getByText('待补充',{exact:true});
   assert.equal(await note.evaluate(e=>getComputedStyle(e).color),'rgb(211, 47, 47)');
   assert.equal(await page.locator(`${region} .mk-signature`).evaluate(e=>getComputedStyle(e).justifyContent),'flex-end');
   assert.equal(await page.locator(region).getByText('表格红字',{exact:true}).evaluate(e=>getComputedStyle(e).color),'rgb(211, 47, 47)');
  }
 }
 await page.evaluate(()=>window.fixture.render(false));
 await page.waitForFunction(()=>!window.fixture.ref.current?.getView().state.readOnly);
 await page.evaluate(()=>{const v=window.fixture.ref.current.getView();v.dispatch({selection:{anchor:v.state.doc.length-6,head:v.state.doc.length}});v.focus()});
 await page.getByRole('button',{name:'下划线',exact:true}).click();
 assert.ok(await page.evaluate(()=>window.fixture.ref.current.getValue().includes('[末尾光标位置]{.underline}')));
 await page.getByRole('button',{name:'下划线',exact:true}).click();
 assert.ok(await page.evaluate(()=>window.fixture.ref.current.getValue().endsWith('末尾光标位置')));
 await page.getByLabel('文字颜色',{exact:true}).fill('#008000');
 assert.ok(await page.evaluate(()=>window.fixture.ref.current.getValue().endsWith('[末尾光标位置]{color="#008000"}')));
 await page.getByLabel('文字颜色',{exact:true}).fill('#2563eb');
 assert.ok(await page.evaluate(()=>window.fixture.ref.current.getValue().endsWith('[末尾光标位置]{color="#2563EB"}')));
 await page.getByRole('button',{name:'跟随样式',exact:true}).click();
 assert.ok(await page.evaluate(()=>window.fixture.ref.current.getValue().endsWith('末尾光标位置')));
 await page.evaluate(()=>{const v=window.fixture.ref.current.getView(),from=v.state.doc.length;v.dispatch({changes:{from,insert:'\n\n段落甲\n\n段落乙'},selection:{anchor:from+2,head:from+10}});v.focus()});
 await page.getByRole('button',{name:'靠右',exact:true}).click();
 assert.ok(await page.evaluate(()=>window.fixture.ref.current.getValue().includes('::: {align="right"}\n\n段落甲\n\n段落乙')));
 await page.locator('#editor').getByText('表格红字',{exact:true}).click();
 const cell=page.locator('#editor textarea[data-table-row="1"][data-table-column="1"]'); await cell.waitFor({state:'visible'}); await cell.evaluate(e=>e.select());
 await page.getByLabel('文字颜色',{exact:true}).dispatchEvent('pointerdown');
 await page.getByLabel('文字颜色',{exact:true}).fill('#008000');
 await page.locator('#editor textarea[data-table-row="1"][data-table-column="1"]:not([hidden])').press('Control+Enter');
 assert.ok(await page.evaluate(()=>window.fixture.ref.current.getValue().includes('[**表格红字**]{color="#008000"}')));
 assert.deepEqual(errors,[]);
 console.log('PASS: editor and Word preview render color/emphasis/table/quote/alignment/signature in both themes; toolbar writes underline syntax.');
}finally{await browser.close()}
