import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1700,height:1100}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:1420'}/tests/browser/yaml-highlighting.html`);
 await page.waitForFunction(()=>Boolean(window.fixture?.view));
 await mkdir('.codex/yaml-highlighting-qa',{recursive:true});
 for(const alias of ['yaml','yml','YAML'])for(const readOnly of [false,true])for(const isDark of [true,false]){
  await page.evaluate(({alias,readOnly,isDark})=>{window.fixture.reset(alias);window.fixture.configure({readOnly,isDark});},{alias,readOnly,isDark});
  await page.locator('#outside').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('#editor [data-yaml-kind]')].some(span=>span.textContent==='slidingWindowSize'));
  const colors=await page.locator('#editor').evaluate(editor=>{
   const find=text=>[...editor.querySelectorAll('span')].find(span=>span.textContent===text);
   const color=text=>{const node=find(text);return node&&getComputedStyle(node).color;};
   return {key:color('slidingWindowSize'),number:color('100'),keyword:color('true'),string:color('COUNT_BASED'),unit:color('2000ms'),comment:color('# 统计最近 100 次调用')};
  });
  assert.ok(Object.values(colors).every(Boolean),JSON.stringify(colors));
  assert.equal(colors.unit,colors.string);
  assert.equal(new Set([colors.key,colors.number,colors.keyword,colors.string,colors.comment]).size,5,JSON.stringify(colors));
  assert.equal(await page.locator('#editor .cm-line').filter({hasText:'普通数字 123'}).locator('[data-yaml-kind]').count(),0);
  assert.equal(await page.evaluate(()=>window.fixture.view.state.doc.toString()),await page.evaluate(()=>window.fixture.source));
  await page.waitForFunction(()=>[...document.querySelectorAll('#preview [data-yaml-kind]')].some(span=>span.textContent==='slidingWindowSize'));
  const previewColors=await page.locator('#preview').evaluate(preview=>Object.fromEntries(['slidingWindowSize','100','true','COUNT_BASED','2000ms'].map(text=>[text,getComputedStyle([...preview.querySelectorAll('[data-yaml-kind]')].find(span=>span.textContent===text)).color])));
  assert.equal(previewColors['COUNT_BASED'],previewColors['2000ms']);
  assert.equal(new Set(Object.values(previewColors)).size,4);
  if(alias==='yaml'&&!readOnly)await page.locator('#editor').screenshot({path:`.codex/yaml-highlighting-qa/editor-${isDark?'dark':'light'}.png`});
 }
 // Changing a parsed scalar while editing must recolor it without changing surrounding source.
 await page.evaluate(()=>{window.fixture.reset();window.fixture.configure({readOnly:false});});
 await page.waitForFunction(()=>document.querySelector('#editor [data-yaml-kind="number"]'));
 await page.evaluate(()=>{const view=window.fixture.view,from=view.state.doc.toString().indexOf('100 #');view.dispatch({changes:{from,to:from+3,insert:'true'},selection:{anchor:from+4}});});
 await page.waitForFunction(()=>[...document.querySelectorAll('#editor [data-yaml-kind="keyword"]')].filter(span=>span.textContent==='true').length===2);
 // Nested quoted fences must keep YAML colors without coloring quote prefixes or JSON.
 await page.evaluate(()=>{const view=window.fixture.view;view.dispatch({changes:{from:0,to:view.state.doc.length,insert:'正文\n\n> ```yaml\n> attempts: 100\n> enabled: true\n> ```\n\n```json\n{"value": 100}\n```'},selection:{anchor:0}});});
 await page.locator('#outside').click();
 await page.waitForFunction(()=>[...document.querySelectorAll('#editor [data-yaml-kind="number"]')].some(span=>span.textContent==='100'));
 assert.equal(await page.locator('#editor [data-yaml-kind]').filter({hasText:'>'}).count(),0);
 assert.equal(await page.locator('#editor [data-yaml-kind="number"]').count(),1,'JSON numbers should retain their own highlighter');
 assert.deepEqual(errors,[]);
 console.log('PASS: YAML/yml/YAML aliases, key/number/boolean/string/unit/comment colors, light/dark, edit/read modes, Word preview, source preservation and live scalar recoloring.');
}finally{await browser.close();}
