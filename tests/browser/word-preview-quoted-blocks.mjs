import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1700,height:1100}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const setSource=async source=>{await page.evaluate(source=>{const v=window.fixture.view;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:source},selection:{anchor:source.length}})},source);await page.waitForTimeout(350);};
try{
 await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:1420'}/tests/browser/table-images.html`);
 await page.waitForFunction(()=>window.fixture?.view);
 const source=['> [!TIP] 引用标题','> 文字开始','>     | 名称 | 说明 |','>     | --- | --- |','>     | **加粗** | `行内代码` |','>','> ```java','> int firstValue = 42;','> ```','>','> 文字结束','>','> | 第二表 | 结果 |','> | --- | --- |','> | 内容 | 成功 |','','引用之外'].join('\n');
 await setSource(source);
 await page.waitForSelector('#preview blockquote table');
 assert.equal(await page.locator('#preview blockquote table').count(),2);
 assert.equal(await page.locator('#preview blockquote pre code').count(),1);
 assert.ok(await page.locator('#preview blockquote table').getByText('加粗',{exact:true}).evaluate(el=>Number(getComputedStyle(el).fontWeight)>=600));
 assert.equal(await page.locator('#preview blockquote table').getByText('行内代码',{exact:true}).count(),1);
 const order=await page.evaluate(()=>[...document.querySelectorAll('#preview blockquote')].map(el=>el.innerText));
 assert.ok(order.findIndex(x=>x.includes('文字开始')) < order.findIndex(x=>x.includes('加粗')));
 assert.ok(order.findIndex(x=>x.includes('加粗')) < order.findIndex(x=>x.includes('firstValue')));
 assert.ok(order.findIndex(x=>x.includes('firstValue')) < order.findIndex(x=>x.includes('文字结束')));
 assert.ok(order.findIndex(x=>x.includes('文字结束')) < order.findIndex(x=>x.includes('第二表')));
 assert.equal(await page.evaluate(()=>window.fixture.source),source,'preview must not modify Markdown');
 for(const isDark of [true,false]){
  await page.evaluate(isDark=>window.fixture.configure({isDark}),isDark);
  assert.equal(await page.locator('#preview blockquote table').count(),2);
  assert.equal(await page.locator('#preview blockquote pre code').count(),1);
 }
 await setSource('> 普通引用\n>\n> ```python\n> print("保留代码")\n> ```\n>\n> | A | B |\n> | --- | --- |\n> | 1 | 2 |');
 assert.equal(await page.locator('#preview blockquote pre').count(),1);
 assert.equal(await page.locator('#preview blockquote table').count(),1);
 await setSource('> [!TIP] 图表\n> ```mermaid\n> flowchart LR\n> A[开始] --> B[完成]\n> ```');
 await page.waitForFunction(()=>{const image=document.querySelector('#preview blockquote img[alt="Mermaid 图表"]');return image?.complete&&image.naturalHeight>0;});
 const rows=Array.from({length:60},(_,i)=>`> | 行${i} | 数据${i} |`);
 const code=Array.from({length:55},(_,i)=>`> let value${i} = ${i};`);
 await setSource(['> [!TIP] 跨页','> | A | B |','> | --- | --- |',...rows,'>','> ```js',...code,'> ```','','结束'].join('\n'));
 const report=await page.evaluate(()=>{
  const pages=[...document.querySelectorAll('#preview .mk-word-preview-page')];
  const tables=[...document.querySelectorAll('#preview blockquote table tbody tr')].map(row=>row.cells[0]?.innerText.trim());
  const code=[...document.querySelectorAll('#preview blockquote pre code')].map(pre=>pre.innerText).join('\n');
  return { pages:pages.length,tables,code,overflow:pages.flatMap((page,index)=>{
   const bounds=page.getBoundingClientRect(), scale=bounds.width/page.offsetWidth;
   const limit=bounds.bottom-parseFloat(getComputedStyle(page).paddingBottom)*scale;
   return [...page.querySelectorAll('blockquote table,blockquote pre')].filter(el=>el.getBoundingClientRect().bottom>limit+2).map(el=>({index,tag:el.tagName,excess:el.getBoundingClientRect().bottom-limit}));
  })};
 });
 assert.ok(report.pages>=3,'long quoted table and code must paginate');
 assert.deepEqual(report.tables,Array.from({length:60},(_,i)=>`行${i}`),'every table row must appear once and in order');
 for(let i=0;i<55;i++) assert.ok(report.code.includes(`value${i} = ${i};`),`missing code line ${i}`);
 assert.deepEqual(report.overflow,[],'quoted tables and code must stay inside page content bounds');
 assert.deepEqual(errors,[]);
 console.log('PASS: quoted tables and code render in order in Word preview, remain inside the quote, and paginate without lost rows or clipped content.');
}finally{await browser.close();}
