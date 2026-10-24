import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {MERMAID_THEMES} from '../../src/lib/mermaid-config.js';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:1420';
const source=await readFile(new URL('../fixtures/conversion/mermaid-cache-patterns.mmd',import.meta.url),'utf8');
const shared=Buffer.from(await readFile(new URL('../../src/lib/mermaid-config.js',import.meta.url))).toString('base64');
const rust=await readFile(new URL('../../src-tauri/src/core/mermaid.rs',import.meta.url),'utf8');
const template=rust.match(/r#"(<!doctype html>[\s\S]*?)"#/)[1];
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 await mkdir('.codex/mermaid-subgraph-titles',{recursive:true});
 const page=await browser.newPage({viewport:{width:2400,height:1600}});
 let html='<!doctype html><body></body>';
 await page.route('**/subgraph-title-test',route=>route.fulfill({contentType:'text/html',body:html}));
 let count=0;
 for(const mode of ['light','dark','export-png','export-svg'])for(const {id:theme} of MERMAID_THEMES){
  if(mode.startsWith('export')){
   const values={source_json:JSON.stringify(source),script_url:`${base}/src-tauri/resources/mermaid/mermaid.min.js`,renderer_config:shared,themes_json:JSON.stringify({light:theme,dark:theme,diagrams:{}}),html_labels:String(mode!=='export-svg'),node_spacing:'50',rank_spacing:'60'};
   html=template.replaceAll('{{','{').replaceAll('}}','}').replace(/\{(source_json|script_url|renderer_config|themes_json|html_labels|node_spacing|rank_spacing)\}/g,(_,name)=>values[name]);
  }else html='<!doctype html><body></body>';
  await page.goto(`${base}/subgraph-title-test`);
  if(mode.startsWith('export')){
   await page.waitForFunction(()=>['ready','error'].includes(document.body.dataset.state));
   assert.equal(await page.locator('body').getAttribute('data-state'),'ready');
   if(mode==='export-svg')await page.evaluate(()=>{const bytes=Uint8Array.from(atob(document.body.dataset.svgBase64),c=>c.charCodeAt(0));document.querySelector('#diagram').innerHTML=new TextDecoder().decode(bytes);});
  }else await page.evaluate(async({source,theme,mode})=>{document.body.style.background=mode==='dark'?'#202124':'white';document.body.innerHTML=(await(await import('/src/lib/mermaid.ts')).renderMermaid(source,mode==='dark',{light:theme,dark:theme,diagrams:{}})).svg;},{source,theme,mode});
  const result=await page.evaluate(async()=>{
   const root=document.querySelector('svg');root.style.maxWidth='none';
   const box=e=>e.getBoundingClientRect().toJSON();
   const clusters=()=>[...root.querySelectorAll('g.cluster')].map(c=>{const label=c.querySelector('.cluster-label');const range=document.createRange();range.selectNodeContents(label);return {rect:box(c.querySelector('rect')),label:range.getBoundingClientRect().toJSON(),text:label.textContent,html:[...label.querySelectorAll('foreignObject,div,span,p')].map(e=>({tag:e.tagName,width:e.getBoundingClientRect().width,client:e.clientWidth,scroll:e.scrollWidth,style:e.getAttribute('style')}))};});
   const before=clusters();
   (await import('/src/lib/mermaid-config.js')).layoutMermaidLabels(root);
   return {before,after:clusters(),nodes:[...root.querySelectorAll('.node')].map(box)};
  });
  const context=`${mode}/${theme}`;
  if(process.env.MERMAID_TITLE_DEBUG&&count===0)console.log(JSON.stringify(result.before));
  assert.equal(result.before.length,3,context);
  for(const cluster of result.before){
   assert.ok(cluster.label.left>=cluster.rect.left+4 && cluster.label.right<=cluster.rect.right-4,`${context}: title exceeds its own card: ${JSON.stringify(cluster)}`);
   assert.ok(cluster.html.every(e=>!e.client||e.scroll<=e.client+1),`${context}: clipped title: ${JSON.stringify(cluster)}`);
   for(const node of result.nodes)assert.ok(Math.min(cluster.label.right,node.right)-Math.max(cluster.label.left,node.left)<=1 || Math.min(cluster.label.bottom,node.bottom)-Math.max(cluster.label.top,node.top)<=1,`${context}: title covers a node`);
   for(const other of result.before.filter(other=>other!==cluster))assert.ok(Math.min(cluster.rect.right,other.rect.right)-Math.max(cluster.rect.left,other.rect.left)<=1 || Math.min(cluster.rect.bottom,other.rect.bottom)-Math.max(cluster.rect.top,other.rect.top)<=1,`${context}: sibling cluster cards overlap`);
  }
  assert.deepEqual(result.after,result.before,`${context}: layout must be idempotent`);
  if(mode==='dark'&&theme==='neutral')await page.locator('svg').screenshot({path:'.codex/mermaid-subgraph-titles/cache-dark.png'});
  count++;
 }
 console.log(`PASS: ${count} cases, all 11 themes, light/dark and real PNG/SVG export: titles stay inside their own cards and clear of nodes.`);
}finally{await browser.close();}
