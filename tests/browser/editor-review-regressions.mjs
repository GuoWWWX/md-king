import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1550,height:1200}}),errors=[],failures=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:1420'}/tests/browser/formatting.html`);
 await page.waitForFunction(()=>window.fixture?.ref.current);
 const render=async(source,dark)=>{
  await page.evaluate(({source,dark})=>window.fixture.render(true,source,dark),{source,dark});
  await page.waitForFunction(source=>window.fixture.ref.current?.getValue()===source,source);
 };
 const check=async(name,run)=>{try{await run();}catch(error){failures.push(`${name}: ${error.message}`);}};
 await page.evaluate(async()=>{
  const {registerBrowserPreviewImage}=await import('/src/lib/browser-preview-images.ts');
  const canvas=document.createElement('canvas');canvas.width=32;canvas.height=16;
  canvas.getContext('2d').fillRect(0,0,32,16);
  registerBrowserPreviewImage('figure one.png',canvas.toDataURL('image/png'));
 });
 for(const dark of [false,true]) {
  await check(`destinations/autolinks dark=${dark}`,async()=>{
   await render('[空格](<target document.md#L2>)\n\n[括号](target\\(1\\).md)\n\n<https://example.com>\n\n<user@example.com>',dark);
   for(const [label,target,path] of [['空格','target%20document.md#L2','target document.md'],['括号','target(1).md','target(1).md'],['https://example.com','https://example.com'],['user@example.com','mailto:user@example.com']]) {
    const link=page.locator('#editor [data-mk-link-target]').filter({hasText:label}).last();
    assert.equal(await link.count(),1,`clickable ${label}`);
    assert.equal(await link.getAttribute('data-mk-link-target'),target);
    await link.click();assert.equal(await page.evaluate(()=>window.fixture.opened.at(-1)),target);
    if(path)assert.equal(await page.evaluate(async({target,path})=>{
     const {loadDocumentReference}=await import('/src/lib/reference-document-loader.ts');
     const document={path,content:'# 标题\n目标第二行'};
     return (await loadDocumentReference(target,{current:{path:'source.md',content:''},openDocuments:[document],availablePaths:[path],readFile:async()=>{throw new Error('must use open document');}})).path;
    },{target,path}),path);
   }
  });
  for(const source of ['![带空格图片](<figure one.png>)','![引用图片][asset]\n\n[asset]: <figure one.png>'])await check(`image ${source} dark=${dark}`,async()=>{
   await render(source,dark);
   const image=page.locator('#editor .mk-cm-image img');
   await image.waitFor({timeout:3000});assert.equal(await image.count(),1);
   assert.ok(await image.evaluate(image=>image.complete&&image.naturalWidth===32));
   assert.equal(await image.getAttribute('alt'),source.startsWith('![引用')?'引用图片':'带空格图片');
  });
  for(const gap of ['\n\n','\n# ','\n- '])await check(`paragraph boundary ${JSON.stringify(gap)} dark=${dark}`,async()=>{
   const source=`[第一段${gap}第二段]{color="#D32F2F"}`;
   await render(source,dark);
   assert.equal(await page.locator('#editor .mk-explicit-color').count(),0);
   assert.ok((await page.locator('#editor .cm-content').innerText()).includes('[第一段'));
   assert.ok((await page.locator('#editor .cm-content').innerText()).includes(']{color="#D32F2F"}'));
   assert.equal(await page.locator('#preview .mk-explicit-color').count(),0);
   assert.equal(await page.evaluate(()=>window.fixture.ref.current.getValue()),source);
  });
  await render('[合法换行\n仍属一段]{color="#D32F2F"}',dark);
  assert.ok(await page.locator('#editor .mk-explicit-color').count());
  const longSource='普通正文 '.repeat(1800)+'\n\n[后段红字]{color="#D32F2F"}';
  await render(longSource,dark);
  await page.evaluate(()=>{const view=window.fixture.ref.current.getView();view.dispatch({selection:{anchor:view.state.doc.length},scrollIntoView:true});});
  await page.locator('#editor .mk-explicit-color').filter({hasText:'后段红字'}).first().waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.ref.current.getValue()),longSource);
 }
 assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
 console.log('PASS: escaped/angle destinations, local reference loading, URL/email autolinks, standalone image references and paragraph-bounded formatting agree with Word preview in both themes.');
} finally {await browser.close();}
