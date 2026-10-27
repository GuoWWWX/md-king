import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1800,height:1200}});
await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:1420'}/tests/browser/mermaid-markdown.html`);
const results=await page.evaluate(async()=>{
 const sources={
  state:'stateDiagram-v2\n [*] --> A\n A --> B: **Alpha** *Beta* `code` $x^2$',
  sequence:'sequenceDiagram\n participant A as **Alpha** *Beta* `code` $x^2$\n participant B\n A->>B: **Alpha** *Beta* `code` $x^2$',
  class:'classDiagram\n class Example["**Alpha** *Beta* `code` $x^2$"]\n Example --> Service: **Alpha** *Beta* `code` $x^2$',
  er:'erDiagram\n USER ||--o{ ORDER : "**Alpha** *Beta* `code` $x^2$"',
  gantt:'gantt\n dateFormat YYYY-MM-DD\n section Plan\n **Alpha** *Beta* `code` $x^2$ :a, 2026-01-01, 3d',
  pie:'pie title Example\n "**Alpha** *Beta* `code` $x^2$" : 60\n "Other": 40',
  journey:'journey\n title Example\n section Docs\n **Alpha** *Beta* `code` $x^2$: 5: User',
  gitGraph:'gitGraph\n commit id: "**Alpha** *Beta* `code` $x^2$"',
  timeline:'timeline\n title Example\n January : **Alpha** *Beta* `code` $x^2$',
  quadrantQuoted:'quadrantChart\n title "**Alpha** *Beta* `code` $x^2$"\n x-axis Low --> High\n y-axis Low --> High\n "**Alpha** *Beta* `code` $x^2$": [0.3, 0.8]',
  xychart:'xychart-beta\n x-axis ["**Alpha** *Beta* `code` $x^2$", "Other"]\n y-axis "Value" 0 --> 100\n bar [35,60]',
  requirement:'requirementDiagram\n requirement doc {\n id: 1\n text: "**Alpha** *Beta* `code` $x^2$"\n risk: low\n verifymethod: test\n }',
  block:'block-beta\n columns 1\n A["**Alpha** *Beta* `code` $x^2$"]',
  packet:'packet-beta\n 0-7: "**Alpha** *Beta* `code` $x^2$"',
  architecture:'architecture-beta\n service api(server)["**Alpha** *Beta* `code` $x^2$"]',
  kanban:'kanban\n todo[To do]\n  task1["**Alpha** *Beta* `code` $x^2$"]',
  sankey:'sankey\n\n"**Alpha** *Beta* `code` $x^2$",Development,80',
  radar:'radar-beta\n axis a["**Alpha** *Beta* `code` $x^2$"], b["B"], c["C"]\n curve plan["Plan"]{80,70,90}',
  treemap:'treemap-beta\n "Project"\n  "**Alpha** *Beta* `code` $x^2$": 60\n  "Other": 25',
  c4:'C4Context\n Person(user, "**Alpha** *Beta* `code` $x^2$", "Author")\n System(app, "App", "Description")\n Rel(user, app, "Use")',
 };
 const out={};
 for(const [name,original] of Object.entries(sources)) for (const list of ['unordered', 'ordered']) for (const dark of [false, true]) {
  const items = list === 'ordered' ? '<br/>1. First<br/>2. Second' : '<br/>- First<br/>- Second';
  const source=original.replaceAll('$x^2$', '$x^2$' + items);
  const caseName = `${name}/${list}/${dark ? "dark" : "light"}`;
  try {const result=await window.fixture.renderMermaid(source,dark);const el=document.createElement('div');el.innerHTML=result.svg;document.body.append(el);const svg=el.querySelector('svg');const found=[...svg.querySelectorAll('text,tspan,foreignObject,span,p,div')].filter(x=>x.textContent.includes('Alpha')&&![...x.children].some(y=>y.textContent.includes('Alpha')));out[caseName]={ordered:svg.querySelectorAll('ol').length, unordered:svg.querySelectorAll('ul').length,labels:found.slice(0,3).map(e=>e.outerHTML.slice(0,850)),html:svg.querySelectorAll('strong').length,em:svg.querySelectorAll('em').length,code:svg.querySelectorAll('code').length,math:svg.querySelectorAll('math').length,li:svg.querySelectorAll('li').length,content:svg.textContent.slice(-250)};el.remove();}catch(e){out[caseName]={error:String(e).slice(0,200)}}
 }
 return out;
});
for (const [name, result] of Object.entries(results)) {
 if (result.error || !result.html || !result.em || !result.code || !result.math || result.li < 2 || (name.includes('/ordered/') ? !result.ordered : !result.unordered)) throw new Error(`${name}: ${JSON.stringify(result)}`);
 console.log(`${name}: PASS`);
}
await browser.close();
