import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];
 page.setDefaultTimeout(20000);
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${process.env.TEST_BASE_URL||'http://127.0.0.1:1420'}/tests/browser/footer-fields.html`);
 const pages=page.locator('[data-preview-page-index]');
 await page.waitForFunction(()=>document.querySelectorAll('[data-preview-page-index]').length>=2);
 await page.waitForTimeout(150);
 const count=await pages.count();
 const footers=()=>page.locator('[data-preview-page-index] .mk-word-preview-page > div[style*="bottom: 48px"]');
 assert.equal(await footers().first().innerText(),`内部资料 · 第 3 页 共 ${count} 页`);
 assert.equal(await footers().last().innerText(),`内部资料 · 第 ${count+2} 页 共 ${count} 页`);
 for(const [format,expected] of [['plain-total',`内部资料 · 3 / ${count}`],['plain','内部资料 · 3'],['page','内部资料 · 第 3 页'],['none','内部资料']]){
  await page.evaluate(format=>window.fixture.configure(format),format);
  await page.waitForFunction(expected=>document.querySelector('[data-preview-page-index] .mk-word-preview-page > div[style*="bottom: 48px"]')?.textContent===expected,expected);
 }
 await page.evaluate(()=>window.fixture.configure('page-total',1,'body',true));
 await page.waitForFunction(()=>document.querySelector('[data-preview-page-kind="toc"]'));
 await page.waitForTimeout(250);
 const numbered=await page.locator('[data-preview-page-kind="document"]').count();
 assert.ok(await page.locator('[data-preview-page-kind="toc"]').count()>0);
 assert.equal(await footers().first().innerText(),`内部资料 · 第 1 页 共 ${numbered} 页`);
 assert.equal(await footers().last().innerText(),`内部资料 · 第 ${numbered} 页 共 ${numbered} 页`);
 assert.deepEqual(errors,[]);
 console.log('PASS: live preview uses actual page count for Chinese/plain total formats, start offsets, legacy page-only formats and disabled page numbers.');
}finally{await browser.close();}
