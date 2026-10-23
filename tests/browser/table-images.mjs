import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1700,height:1100}}), errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:1420'}/tests/browser/table-images.html`);
 await page.waitForFunction(()=>Boolean(window.fixture?.view));
 const cell=(row,column)=>page.locator(`#editor .mk-cm-table-cell-content[data-table-row="${row}"][data-table-column="${column}"]`);
 const input=(row,column)=>page.locator(`#editor textarea[data-table-row="${row}"][data-table-column="${column}"]`);
 const finish=async()=>{await page.locator('#outside').click();await page.waitForTimeout(100);};
 await page.waitForFunction(()=>[...document.querySelectorAll('#editor .mk-cm-table img')].length===2&&[...document.querySelectorAll('#editor .mk-cm-table img')].every(img=>img.naturalWidth===240));
 await page.waitForFunction(()=>[...document.querySelectorAll('#preview th img,#preview td img')].length>=2&&[...document.querySelectorAll('#preview th img,#preview td img')].every(img=>img.naturalWidth===240));
 const previewBounds=await page.locator('#preview th img,#preview td img').evaluateAll(images=>images.map(image=>({height:image.getBoundingClientRect().height,width:image.getBoundingClientRect().width,cellWidth:image.closest('th,td').getBoundingClientRect().width})));
 assert.ok(previewBounds.every(image=>image.height>20&&image.height<=160&&image.width<=image.cellWidth),'table images must be readable and fit their cells');
 // Native image paste replaces only the textarea selection and takes priority over accompanying text.
 await cell(1,0).click();await input(1,0).focus();
 await input(1,0).evaluate(element=>element.setSelectionRange(1,1));
 await page.evaluate(()=>window.fixture.paste(1,0));
 await page.waitForFunction(()=>window.fixture.source.includes('前![粘贴图片 1](assets/pasted-1.png)后'));
 await finish();
 assert.equal(await cell(1,0).locator('img').count(),1);
 assert.match(await page.evaluate(()=>window.fixture.source),/表格外正文不能被替换/);
 assert.doesNotMatch(await page.evaluate(()=>window.fixture.source),/必须忽略/);
 // Multiple images remain in one cell and a real Markdown reference previews on blur.
 await cell(3,0).click();await input(3,0).evaluate(element=>element.select());
 await page.evaluate(()=>window.fixture.paste(3,0,2));
 await page.waitForFunction(()=>window.fixture.source.includes('pasted-3.png'));
 await finish();assert.equal(await cell(3,0).locator('img').count(),2);
 await cell(3,1).click();await input(3,1).fill('说明 ![本地引用](assets/existing.png)');await finish();
 await page.waitForFunction(()=>document.querySelector('#editor td[data-table-row="3"][data-table-column="1"] img')?.naturalWidth===240);
 // Custom context menu uses native image clipboard, then still supports text when no image exists.
 await page.evaluate(()=>window.fixture.nativeClipboard());
 await cell(1,1).click({button:'right'});
 await page.getByRole('menuitem',{name:'粘贴',exact:true}).click();
 await page.waitForFunction(()=>window.fixture.source.includes('pasted-4.png'));await finish();
 await page.evaluate(()=>window.fixture.nativeClipboard(false));
 await cell(1,1).click({button:'right'});await page.getByRole('menuitem',{name:'粘贴',exact:true}).click();
 await page.waitForFunction(()=>window.fixture.source.includes('菜单文字'));await finish();
 // Dropping an image on a cell must not insert it at CodeMirror's unrelated body cursor.
 await cell(3,0).evaluate((element,data)=>{
  const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0))],'drop.png',{type:'image/png'}));
  element.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
 },await page.evaluate(()=>window.fixture.data));
 await page.waitForFunction(()=>window.fixture.source.includes('pasted-5.png'));await finish();
 // References also render in dark and read-only table modes.
 for(const config of [{isDark:true},{readOnly:true},{readOnly:false,isDark:false}]){
  await page.evaluate(config=>window.fixture.configure(config),config);
  await page.waitForFunction(()=>[...document.querySelectorAll('#editor .mk-cm-table img')].every(img=>img.naturalWidth===240));
  if(config.readOnly){
   const before=await page.evaluate(()=>({source:window.fixture.source,imported:window.fixture.imported}));
   await page.evaluate(()=>window.fixture.paste(3,1));
   assert.deepEqual(await page.evaluate(()=>({source:window.fixture.source,imported:window.fixture.imported})),before,'read-only paste must not import or change images');
  }
 }
 await page.evaluate(()=>window.fixture.configure({markdownSourcePath:'other/document.md'}));
 await page.waitForFunction(()=>window.fixture.loadRequests.some(request=>request.sourcePath==='other/document.md'));
 await page.evaluate(()=>window.fixture.configure({markdownSourcePath:'notes/document.md'}));
 // A delayed import may not leak into a newly opened document.
 await cell(3,1).click();await page.evaluate(()=>{window.fixture.setDelay(250);window.fixture.paste(3,1);window.fixture.reset();});
 await page.waitForTimeout(400);
 assert.doesNotMatch(await page.evaluate(()=>window.fixture.source),/pasted-6/);
 await page.evaluate(()=>window.fixture.setDelay(0));
 await finish();
 await mkdir('.codex/table-images-qa/notes/assets',{recursive:true});
 const data=await page.evaluate(()=>window.fixture.data);
 await writeFile('.codex/table-images-qa/notes/assets/existing.png',Buffer.from(data.split(',')[1],'base64'));
 await writeFile('.codex/table-images-qa/notes/document.md',await page.evaluate(()=>window.fixture.source));
 await page.locator('#editor').screenshot({path:'.codex/table-images-qa/editor.png'});
 await page.locator('#preview').screenshot({path:'.codex/table-images-qa/word-preview.png'});
 assert.deepEqual(errors,[]);
 console.log('PASS: table image references, selected-text paste, multiple images, cell drop, native context-menu image/text paste, read-only/dark rendering, bounded preview dimensions, and stale import isolation.');
}finally{await browser.close();}
