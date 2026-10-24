import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const email='590731747@qq.com',target=`mailto:${email}`;
const source=`联系：${email}。\n\n**${email}**\n\n*${email}*\n\n***${email}***\n\n> 引用 ${email}\n\n- 列表 ${email}\n\n<${email}>\n\n[显式邮箱](${target})\n\n| 邮箱 |\n| --- |\n| ${email} |\n\n\`${email}\`\n\n\`\`\`text\n${email}\n\`\`\`\n\n$${email}$\n\n末尾正文`;
try {
 const page=await browser.newPage({viewport:{width:1550,height:1400}}),errors=[];
 page.setDefaultTimeout(10000);
 page.on('pageerror',error=>errors.push(error.message));
 const base=process.env.TEST_BASE_URL||'http://127.0.0.1:1420';
 await page.goto(`${base}/tests/browser/formatting.html`);
 await page.waitForFunction(()=>window.fixture?.ref.current);
 for(const dark of [false,true])for(const reading of [false,true]) {
  await page.evaluate(({reading,source,dark})=>window.fixture.render(reading,source,dark),{reading,source,dark});
  await page.waitForFunction(source=>window.fixture.ref.current?.getValue()===source,source);
  if(!reading)await page.evaluate(()=>{const view=window.fixture.ref.current.getView();view.dispatch({selection:{anchor:view.state.doc.length}});});
  const links=page.locator(`#editor [data-mk-link-target="${target}"]`).filter({hasText:email});
  assert.equal(await links.count(),8,`all bare/angle/table email contexts dark=${dark} reading=${reading}`);
  for(let i=0;i<await links.count();i++){
   const opened=await page.evaluate(()=>window.fixture.opened.length);
   await links.nth(i).click();
   assert.equal(await page.evaluate(()=>window.fixture.opened.length),opened+1,'each click must open exactly once');
   assert.equal(await page.evaluate(()=>window.fixture.opened.at(-1)),target);
   if(!reading)await page.evaluate(()=>{const view=window.fixture.ref.current.getView();view.dispatch({selection:{anchor:view.state.doc.length}});});
  }
  assert.equal(await page.locator('#editor .mk-cm-inline-code [data-mk-link-target],#editor .mk-cm-code [data-mk-link-target],#editor .mk-cm-math [data-mk-link-target]').count(),0);
  assert.equal(await page.evaluate(()=>window.fixture.ref.current.getValue()),source,'clicking must not edit Markdown');
 }
 // Keeping the caret inside the address must still allow normal source editing.
 await page.evaluate(({source})=>window.fixture.render(false,source,false),{source:`${email}\n\n末尾`});
 await page.waitForFunction(email=>window.fixture.ref.current?.getValue().startsWith(email),email);
 await page.evaluate(()=>{const view=window.fixture.ref.current.getView();view.dispatch({selection:{anchor:5}});view.focus();});
 await page.waitForFunction(()=>!document.querySelector('#editor [data-mk-link-target]'));
 assert.equal(await page.locator('#editor [data-mk-link-target]').count(),0);
 await page.keyboard.type('1');
 assert.ok((await page.evaluate(()=>window.fixture.ref.current.getValue())).startsWith('5907311747@qq.com'));
 // Exercise the actual page's external-link routing without opening a user's mail app.
 await page.goto(base);
 await page.waitForFunction(()=>document.getElementById('root')?.childElementCount>0);
 await page.evaluate(async({email})=>{
  const {useDocumentTabsStore}=await import('/src/stores/document-tabs-store.ts');
  const {useAppStore}=await import('/src/stores/app-store.ts');
  const store=useDocumentTabsStore.getState();store.closeAllTabs();
  store.openVaultTab({path:'email.md',absolutePath:'D:/email-qa/email.md',title:'email.md',content:`联系 ${email}\n\n末尾`});
  useAppStore.getState().setActivePage('convert');
  window.openedMail=[];window.open=(...args)=>{window.openedMail.push(args[0]);return null;};
 },{email});
 await page.locator(`.mk-cm-host [data-mk-link-target="${target}"]`).filter({hasText:email}).click();
 await page.waitForFunction(target=>window.openedMail.at(-1)===target,target);
 assert.deepEqual(errors,[]);
 console.log('PASS: bare email mailto clicks in body/emphasis/quotes/lists/tables, light/dark and edit/read modes; literal code/math, source editing, and production external-link routing.');
} finally {await browser.close();}
