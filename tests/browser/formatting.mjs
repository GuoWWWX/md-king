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
   const plain=page.locator(region).getByText('普通居中',{exact:true});
   assert.equal(await plain.evaluate(e=>!!e.closest('.mk-cm-link,a')),false,`${region}: alignment is not a link`);
   const heading=text=>region==='#preview'?page.locator('#preview [data-markdown-heading-id]').filter({hasText:text}):page.locator(region).getByText(text,{exact:true});
   const baseline=heading('对照标题');
   for(const [text,align] of [['居中标题','center'],['分组标题','right']]) {
    const title=heading(text);
    const style=el=>{const s=getComputedStyle(el.closest('.cm-line,[data-markdown-heading-id]')||el);return {size:s.fontSize,weight:s.fontWeight,family:s.fontFamily,align:s.textAlign}};
    const actual=await title.evaluate(style), expected=await baseline.evaluate(style);
    assert.equal(actual.align,align,`${region}: ${text}`);
    for(const key of ['size','weight','family'])assert.equal(actual[key],expected[key],`${region}: ${text} ${key}`);
   }
   const red=page.locator(region).getByText('红色粗斜体',{exact:true});
   assert.equal(await red.evaluate(e=>getComputedStyle(e).color),'rgb(211, 47, 47)',`${region} dark=${dark}`);
   assert.equal(await page.locator(region).getByText('红色网页',{exact:true}).evaluate(e=>getComputedStyle(e).color),'rgb(211, 47, 47)',`${region} link dark=${dark}`);
   const center=page.locator(region).getByText('普通居中',{exact:true});
   assert.equal(await center.evaluate(e=>getComputedStyle(e.closest('.cm-line,p')||e).textAlign),'center');
   const note=page.locator(region).getByText('待补充',{exact:true});
   assert.equal(await note.evaluate(e=>getComputedStyle(e).color),'rgb(211, 47, 47)');
   assert.equal(await page.locator(`${region} .mk-signature`).evaluate(e=>getComputedStyle(e).justifyContent),'flex-end');
   assert.equal(await page.locator(region).getByText('表格红字',{exact:true}).evaluate(e=>getComputedStyle(e).color),'rgb(211, 47, 47)');
   for(const [text,verticalAlign] of [['正文下标','sub'],['引用上标','super'],['表格下标','sub']]) {
    const label=page.locator(region).getByText(text,{exact:true});
    const style=await label.evaluate(e=>{
     const selector='[style*="vertical-align"]';
     const formatted=e.closest(selector)||e.querySelector(selector)||e;
     const computed=getComputedStyle(formatted);
     return { verticalAlign:computed.verticalAlign, color:computed.color,
      inheritedColor:getComputedStyle(e.closest('.cm-line,p,blockquote')||e).color,
      link:!!e.closest('a,.mk-cm-link') };
    });
    assert.equal(style.verticalAlign,verticalAlign,`${region}: ${text}`);
    assert.equal(style.color,text==='表格下标'?'rgb(37, 99, 235)':style.inheritedColor,`${region}: ${text} color`);
    assert.equal(style.link,false,`${region}: ${text} is ordinary text`);
   }
   assert.equal(await page.locator(region).getByText('第 1 ~ 6 月',{exact:true}).count(),1);
   const content=await page.locator(region).textContent();
   assert.ok(content.includes('[源码转义]{.sub}'),`${region}: escaped brackets render literally`);
   assert.ok(content.includes('[源码示例]{.sup}'),`${region}: inline code renders literally`);
  }
 }
 await page.evaluate(()=>window.fixture.render(false));
 await page.waitForFunction(()=>!window.fixture.ref.current?.getView().state.readOnly);
 await page.evaluate(()=>{const v=window.fixture.ref.current.getView(),from=v.state.doc.toString().indexOf('[普通居中]')+1;v.dispatch({selection:{anchor:from}});v.focus()});
 const editing=page.locator('#editor .cm-line').filter({hasText:'普通居中'});
 assert.equal(await editing.locator('.mk-cm-link').count(),0);
 assert.equal(await editing.evaluate(e=>getComputedStyle(e).textAlign),'center');
 await page.evaluate(()=>{
  const view=window.fixture.ref.current.getView();
  const from=view.state.doc.toString().indexOf('[正文下标]{.sub}');
  view.dispatch({selection:{anchor:from+1}});
 });
 const sourceLine=page.locator('#editor .cm-line').filter({hasText:'正文下标'});
 assert.ok((await sourceLine.textContent()).includes('[正文下标]{.sub}'));
 assert.ok(await page.evaluate(()=>window.fixture.ref.current.getValue()===window.fixture.source));
 assert.equal(await page.getByRole('toolbar',{name:'文字格式'}).count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: handwritten formatting keeps headings/fonts/alignment, real links and checkbox syntax in both themes; editing preserves source without false links.');
}finally{await browser.close()}
