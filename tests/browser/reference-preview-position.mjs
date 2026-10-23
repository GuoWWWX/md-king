import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1100,height:700}}),errors=[];
 page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:1420'}/tests/browser/document-references.html`);
 await page.waitForFunction(()=>Boolean(window.fixture?.view));
 const popup=page.getByRole('dialog',{name:'引用内容预览'});
 async function show({top,left=180,count=2,dark=false}){
  await page.mouse.move(1090,5);await page.keyboard.press('Escape');
  await page.evaluate(({top,left,count,dark})=>{
   window.fixture.configure({dark});
   window.fixture.setTarget(Array.from({length:count},(_,i)=>`引用内容第 ${i+1} 行`).join('\n'));
   document.querySelector('#position-trigger')?.remove();
   const scope=document.createElement('div');scope.id='position-trigger';scope.dataset.referenceScope='';
   scope.style.cssText=`position:fixed;left:${left}px;top:${top}px;z-index:50`;
   const link=document.createElement('a');link.href=`b.md#L1-L${count}`;link.textContent='当前引用';scope.append(link);document.body.append(scope);
  },{top,left,count,dark});
  await page.locator('#position-trigger a').hover();await popup.locator('.cm-content').waitFor();
  await page.waitForTimeout(100);
  return page.evaluate(()=>{
   const card=document.querySelector('[data-reference-preview]').getBoundingClientRect();
   const link=document.querySelector('#position-trigger a').getBoundingClientRect();
   return {card:{top:card.top,bottom:card.bottom,left:card.left,right:card.right,height:card.height},link:{top:link.top,bottom:link.bottom,left:link.left}};
  });
 }
 for(const dark of [false,true]){
  let box=await show({top:600,dark});
  assert.ok(box.card.bottom<=box.link.top,'Insufficient space below must flip the preview above its reference');
  assert.ok(Math.abs(box.link.top-box.card.bottom-6)<=1,`Above card must hug the reference, not reserve maximum height: ${JSON.stringify(box)}`);
  if(dark){
   await mkdir('.codex/reference-preview-position-qa',{recursive:true});
   await page.screenshot({path:'.codex/reference-preview-position-qa/above-dark.png',clip:{x:170,y:450,width:480,height:200}});
  }
  box=await show({top:490,dark});
  assert.ok(Math.abs(box.card.top-box.link.bottom-6)<=1,`Short preview should fit below using its real height: ${JSON.stringify(box)}`);
  assert.ok(Math.abs(box.card.left-box.link.left)<=1,'Card should align with its reference');
  box=await show({top:430,count:30,dark});
  assert.ok(Math.abs(box.link.top-box.card.bottom-6)<=1,`Long loaded content must recalculate placement: ${JSON.stringify(box)}`);
  box=await show({top:340,count:30,left:960,dark});
  assert.ok(box.card.top>=8&&box.card.bottom<=692&&box.card.right<=1092,JSON.stringify(box));
  assert.ok(Math.abs(box.link.top-box.card.bottom-6)<=1,'Constrained long preview should remain adjacent to the reference');
  await popup.locator('.cm-scroller').evaluate(element=>{element.scrollTop=element.scrollHeight;});
  assert.equal(await popup.isVisible(),true,'Internal scrolling must keep the preview open');
  assert.ok(await popup.locator('.cm-scroller').evaluate(element=>Math.abs(element.scrollHeight-element.clientHeight-element.scrollTop)<=1),'Constrained preview must scroll to its final line');
  box=await show({top:15,count:30,dark});
  assert.ok(Math.abs(box.card.top-box.link.bottom-6)<=1&&box.card.bottom<=692,JSON.stringify(box));
 }
 await page.setViewportSize({width:520,height:320});await page.waitForTimeout(150);
 const small=await show({top:180,left:400,count:30,dark:true});
 assert.ok(small.card.top>=8&&small.card.bottom<=312&&small.card.left>=8&&small.card.right<=512,JSON.stringify(small));
 assert.ok(Math.abs(small.link.top-small.card.bottom-6)<=1,'Small viewport must constrain the card while keeping it adjacent');
 assert.deepEqual(errors,[]);
 console.log('PASS: actual-height placement, adjacent above/below anchors, loaded-content flip, constrained body scrolling, horizontal viewport edge, light/dark.');
}finally{await browser.close();}
