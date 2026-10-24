import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const source='[da] [说明] [显示][missing] [未定义][]\n\n[普通链接](https://example.com/inline)\n\n[引用显示][site]、[site][]、[site]\n\n[site]: https://example.com/reference\n\n- [ ] 待办事项\n\n`[代码](https://example.com/code)`\n\n> [引用内文字]\n\n| 列 |\n| --- |\n| [表格文字] |';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1550,height:1200}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:1420'}/tests/browser/formatting.html`);
 await page.waitForFunction(()=>window.fixture?.ref.current);
 for(const dark of [false,true])for(const reading of [false,true]) {
  await page.evaluate(({reading,source,dark})=>window.fixture.render(reading,source,dark),{reading,source,dark});
  await page.waitForFunction(source=>window.fixture.ref.current?.getValue()===source,source);
  const content=page.locator('#editor .cm-content');
  assert.ok((await content.innerText()).includes('[da] [说明] [显示][missing] [未定义][]'),`literal brackets dark=${dark} reading=${reading}`);
  const metrics=await content.evaluate(e=>{
   const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let node;
   while(node=walker.nextNode())if(node.nodeValue.includes('da')){const el=node.parentElement;return {color:getComputedStyle(el).color,normal:getComputedStyle(el.closest('.cm-line')).color,link:!!el.closest('.mk-cm-link,[data-mk-link-target]')};}
  });
  assert.equal(metrics.color,metrics.normal);assert.equal(metrics.link,false);
  assert.ok(await page.locator('#editor [data-mk-link-target="https://example.com/inline"]').count());
  assert.ok(await page.locator('#editor [data-mk-link-target="https://example.com/reference"]').count());
  assert.ok((await page.locator('#preview').innerText()).includes('[da] [说明] [显示][missing] [未定义][]'));
  assert.equal(await page.locator('#preview a[href="https://example.com/reference"]').count(),3);
  assert.equal(await page.locator('#editor [role="checkbox"]').getAttribute('aria-checked'),'false');
  assert.equal(await page.locator('#editor .mk-cm-inline-code [data-mk-link-target]').count(),0);
  if(reading){
   await page.locator('#editor').getByText('引用显示',{exact:true}).click();
   assert.equal(await page.evaluate(()=>window.fixture.opened.at(-1)),'https://example.com/reference');
  }
 }
 // Recognized wikilink source has gray bracket pairs and normal content text.
 const wiki='[[引用测试资料/目标 文档.md#知识库检索|查看知识库检索整章]]';
 for(const dark of [false,true]) {
  const content=`${wiki}\n\n普通正文`;
  await page.evaluate(({content,dark})=>window.fixture.render(false,content,dark),{content,dark});
  await page.waitForFunction(content=>window.fixture.ref.current?.getValue()===content,content);
  for(const range of [{anchor:wiki.length-1},{anchor:0,head:wiki.length}]) {
   await page.evaluate(range=>{const view=window.fixture.ref.current.getView();view.dispatch({selection:range});view.focus();},range);
   const line=page.locator('#editor .cm-line').filter({hasText:wiki});
   await line.waitFor();
   const metrics=await line.evaluate(e=>{
    const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT),parts=[];let node;
    while(node=walker.nextNode())if(node.nodeValue.trim())parts.push({text:node.nodeValue,color:getComputedStyle(node.parentElement).color});
    return {normal:getComputedStyle(e).color,parts};
   });
   assert.equal(metrics.parts.map(part=>part.text).join(''),wiki);
   for(const part of metrics.parts)for(const char of part.text)assert.equal(part.color,'[]'.includes(char)?dark?'rgb(113, 113, 122)':'rgb(148, 163, 184)':metrics.normal,`wikilink source dark=${dark}: ${JSON.stringify(part)}`);
  }
  await page.evaluate(()=>{const view=window.fixture.ref.current.getView();view.dispatch({selection:{anchor:view.state.doc.length}});});
  const rendered=page.locator('#editor [data-mk-link-target="引用测试资料/目标 文档.md#知识库检索"]');
  await rendered.waitFor();assert.ok((await rendered.innerText()).includes('查看知识库检索整章'));
  await rendered.click();
  assert.equal(await page.evaluate(()=>window.fixture.opened.at(-1)),'引用测试资料/目标 文档.md#知识库检索');
 }
 await page.evaluate(()=>window.fixture.render(false,'[动态]',false));
 await page.waitForFunction(()=>window.fixture.ref.current?.getValue()==='[动态]');
 await page.evaluate(()=>{const v=window.fixture.ref.current.getView();v.dispatch({changes:{from:v.state.doc.length,insert:'\n\n[动态]: https://example.com/live'}});});
 await page.locator('#editor [data-mk-link-target="https://example.com/live"]').first().waitFor();
 await page.evaluate(()=>{const v=window.fixture.ref.current.getView();v.dispatch({changes:{from:4,to:v.state.doc.length}});});
 await page.waitForFunction(()=>!document.querySelector('#editor [data-mk-link-target="https://example.com/live"]'));
 assert.equal((await page.locator('#editor .cm-content').innerText()).trim(),'[动态]');
 assert.deepEqual(errors,[]);
 console.log('PASS: undefined brackets stay literal; valid inline/reference links, tasks, code, quotes and tables work in light/dark edit/read modes; definition edits update targets; wikilink brackets are gray, content stays normal and rendered links still open.');
} finally {await browser.close();}
