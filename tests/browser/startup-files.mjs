import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1500,height:1000}});
 const calls=[],errors=[];let pending=['C:\\测试 文件\\打开方式 中文.md'];
 await context.exposeFunction('takePending',label=>{calls.push(label);const paths=pending;pending=[];return paths;});
 const base=process.env.TEST_BASE_URL||'http://127.0.0.1:1420';
 const secondary=await context.newPage();secondary.on('pageerror',error=>errors.push(error.message));
 await secondary.goto(`${base}/tests/browser/startup-files.html?floating=1&label=floating-converter`);
 await secondary.waitForFunction(()=>Boolean(window.fixture));await secondary.waitForTimeout(700);
 assert.deepEqual(calls,[],'floating window must not drain shell-open paths');
 const project=await context.newPage();project.on('pageerror',error=>errors.push(error.message));
 await project.goto(`${base}/tests/browser/startup-files.html?label=project-test`);
 await project.waitForFunction(()=>Boolean(window.fixture));await project.waitForTimeout(500);
 assert.deepEqual(calls,[],'project window must not drain main-window shell paths');
 const main=await context.newPage();main.on('pageerror',error=>errors.push(error.message));
 await main.goto(`${base}/tests/browser/startup-files.html?session=1`);
 await main.waitForFunction(()=>window.fixture?.tabs.getState().tabs.some(tab=>tab.title==='打开方式 中文.md'));
 await main.waitForTimeout(250);
 assert.deepEqual(await main.evaluate(()=>{const state=window.fixture.tabs.getState();const tab=state.tabs.find(tab=>tab.id===state.activeTabId);return {title:tab.title,content:tab.content,page:window.fixture.app.getState().activePage,eol:tab.eol,hasBom:tab.hasBom};}),{title:'打开方式 中文.md',content:'# 从打开方式载入\n\n这是选中的外部文档。',page:'convert',eol:'crlf',hasBom:true});
 // Existing process: even a global notification may not let auxiliary windows steal the queue.
 pending=['C:\\测试 文件\\第二份 文档.md'];
 await secondary.evaluate(()=>window.fixture.notify());await project.evaluate(()=>window.fixture.notify());
 assert.equal(pending.length,1);
 await main.evaluate(()=>window.fixture.notify());
 await main.waitForFunction(()=>window.fixture.tabs.getState().tabs.find(tab=>tab.id===window.fixture.tabs.getState().activeTabId)?.title==='第二份 文档.md');
 assert.ok(calls.length>0&&calls.every(label=>label==='main'));
 assert.deepEqual(errors,[]);
 console.log('PASS: floating/project windows never consume shell files; main opens cold-start and running-instance files with Chinese/spaces; old session cannot hide the selected file; BOM/EOL retained.');
}finally{await browser.close();}
