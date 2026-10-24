import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1550,height:1200}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:1420'}/tests/browser/formatting.html`);
 await page.waitForFunction(()=>window.fixture?.ref.current);
 const render=async(content,dark,reading=false)=>{
  await page.evaluate(({content,dark,reading})=>window.fixture.render(reading,content,dark),{content,dark,reading});
  await page.waitForFunction(content=>window.fixture.ref.current?.getValue()===content,content);
 };
 const colors=element=>element.evaluate(e=>{
  const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT),chars=[];let node;
  while(node=walker.nextNode())for(const char of node.nodeValue)chars.push({char,color:getComputedStyle(node.parentElement).color});
  return {chars,normal:getComputedStyle(e).color};
 });
 const literal='[da] [] [ ] [x] [[]] [[ ]] [[|别名]] [[目标|]] [未闭合 [显示][missing] [无定义][] ![图片][missing] [文字]{color="red"} [!NOTE] ![[未支持嵌入]]';
 for(const dark of [false,true]) {
  const gray=dark?'rgb(113, 113, 122)':'rgb(148, 163, 184)';
  for(const reading of [false,true]) {
   await render(`${literal}\n\n> [引用内文字]\n\n| 列 |\n| --- |\n| [表格文字] |`,dark,reading);
   const line=page.locator('#editor .cm-line').filter({hasText:'[da]'});
   const actual=await colors(line);
   assert.equal(actual.chars.map(item=>item.char).join(''),literal);
   for(const item of actual.chars)assert.equal(item.color,actual.normal,`literal dark=${dark} reading=${reading}: ${JSON.stringify(item)}`);
   const quote=await colors(page.locator('#editor .cm-line').filter({hasText:'[引用内文字]'}));
   for(const item of quote.chars.filter(item=>'[]'.includes(item.char)))assert.equal(item.color,quote.normal);
   const cell=await colors(page.locator('#editor .mk-cm-table td').filter({hasText:'[表格文字]'}));
   for(const item of cell.chars)assert.equal(item.color,cell.normal);
  }
  for(const source of ['### [da]','**[da]**','*[da]*','***[da]***','- [da]','> **[da]**']) {
   await render(source,dark);
   const actual=await colors(page.locator('#editor .cm-line').filter({hasText:'[da]'}));
   const normal=actual.chars.find(item=>item.char==='d').color;
   for(const item of actual.chars.filter(item=>'[]'.includes(item.char)))assert.equal(item.color,normal,source);
  }
  const cases=[
   ['[链接](https://example.com)','[链接](https://example.com)'],
   ['[空目的地址]()','[空目的地址]()'],
   ['[引用][site]','[引用][site]'],
   ['[site][]','[site][]'],
   ['[site]','[site]'],
   ['![图片](photo.png)','![图片](photo.png)'],
   ['![引用][asset]','![引用][asset]'],
   ['![asset][]','![asset][]'],
   ['![asset]','![asset]'],
   ['[[目标.md#L3-L4|显示文字]]','[[目标.md#L3-L4|显示文字]]'],
   ['[格式]{.underline}','[格式]{.underline}'],
   ['[红字]{color="#D32F2F"}','[红字]{color="#D32F2F"}'],
   ['- [ ] 待办','[ ]'],
   ['- [x] 完成','[x]'],
   ['> [!NOTE] 提示','[!NOTE]'],
   ['[site]: https://example.com','[site]: https://example.com'],
  ];
  for(const [source,visible] of cases) {
   await render(`${source}\n\n[site]: https://example.com\n[asset]: photo.png\n\n末尾`,dark);
   await page.evaluate(source=>{const view=window.fixture.ref.current.getView();view.dispatch({selection:{anchor:Math.min(3,source.length-1)}});view.focus();},source);
   const line=page.locator('#editor .cm-line').first();
   await line.filter({hasText:visible}).waitFor({timeout:5000});
   const actual=await colors(line),brackets=actual.chars.filter(item=>'[]'.includes(item.char));
   assert.ok(brackets.length>=2,source);
   for(const item of brackets)assert.equal(item.color,gray,`recognized dark=${dark} ${source}: ${JSON.stringify(item)}`);
   if(source.startsWith('[['))for(const item of actual.chars.filter(item=>!'[]'.includes(item.char)))assert.equal(item.color,actual.normal);
   if(source.startsWith('[红字]'))for(const item of actual.chars.filter(item=>'红字'.includes(item.char)))assert.equal(item.color,'rgb(211, 47, 47)');
  }
  for(const source of ['\\[转义\\]','[链接](javascript:alert)','![图片](javascript:alert)']) {
   await render(source,dark);
   const actual=await colors(page.locator('#editor .cm-line').first());
   for(const item of actual.chars.filter(item=>'[]'.includes(item.char)))assert.equal(item.color,actual.normal,source);
   assert.equal(await page.locator('#editor [data-mk-link-target]').count(),0);
  }
  for(const [literal,from,to,insert] of [['[动态]',4,4,'\n\n[动态]: https://example.com'],['[[]]',2,2,'目标']]) {
   await render(literal,dark);
   await page.evaluate(({from,to,insert})=>{const view=window.fixture.ref.current.getView();view.dispatch({selection:{anchor:1},changes:{from,to,insert}});view.focus();},{from,to,insert});
   const recognized=await colors(page.locator('#editor .cm-line').first());
   for(const item of recognized.chars.filter(item=>'[]'.includes(item.char)))assert.equal(item.color,gray,`after recognition: ${literal}`);
   await page.evaluate(({from,insert})=>{const view=window.fixture.ref.current.getView();view.dispatch({changes:{from,to:from+insert.length}});},{from,insert});
   const restored=await colors(page.locator('#editor .cm-line').first());
   assert.equal(restored.chars.map(item=>item.char).join(''),literal);
   for(const item of restored.chars)assert.equal(item.color,restored.normal,`back to literal: ${literal}`);
  }
  await render('`[代码] [[原样]]`\n\n```json\n[1, 2]\n```',dark,true);
  assert.ok((await page.locator('#editor .cm-content').innerText()).includes('[代码] [[原样]]'));
  assert.equal(await page.locator('#editor .mk-cm-inline-code .mk-cm-syntax-bracket, #editor .mk-cm-code-line .mk-cm-syntax-bracket').count(),0);
  assert.equal(await page.locator('#editor [data-mk-link-target]').count(),0);
  const math='$[x](path.md) + ![y](a.png) + [[目标]]$';
  await render(math,dark);
  await page.evaluate(()=>{const view=window.fixture.ref.current.getView();view.dispatch({selection:{anchor:2}});view.focus();});
  await page.locator('#editor .mk-cm-math-source').first().waitFor();
  assert.ok((await page.locator('#editor .cm-content').innerText()).includes(math));
  assert.equal(await page.locator('#editor .mk-cm-syntax-bracket, #editor [data-mk-link-target]').count(),0);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: literal/empty/undefined brackets retain text color; recognized links, image references, wikilinks, format attributes, tasks, Callouts and definitions have gray brackets; escapes and code stay literal in both themes.');
} finally {await browser.close();}
