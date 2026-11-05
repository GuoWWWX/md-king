import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:1420';
const source = await readFile('tests/fixtures/conversion/mermaid-object-allocation.mmd', 'utf8');
const output = '.codex/mermaid-node-width';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 2200, height: 3200 } });
  await page.goto(`${base}/tests/browser/mermaid-markdown.html`);
  await page.waitForFunction(() => window.fixture);
  async function check(name, expected = true) {
    const nodes = await page.evaluate(() => [...document.querySelectorAll('svg .node')].map(node => {
      const foreign = node.querySelector('foreignObject');
      const label = foreign?.querySelector('.nodeLabel') || node.querySelector('text');
      if (!label) return null;
      const rows = [];
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(walker.currentNode);
        rows.push(...range.getClientRects());
      }
      const shape = node.querySelector('.label-container'), box = label.getBoundingClientRect();
      return { text: label.textContent, lists: label.querySelectorAll('ol,ul').length, bold: label.querySelectorAll('strong,b').length,
        lines: new Set(rows.filter(row=>row.width).map(row=>Math.round(row.top))).size,
        width: box.width, center: (box.top+box.bottom-shape.getBoundingClientRect().top-shape.getBoundingClientRect().bottom)/2 };
    }).filter(Boolean));
    await page.locator('svg').screenshot({ path: `${output}/${name}.png` });
    if (expected) {
      assert.equal(nodes.length, 14);
      for (const title of ['1. 类加载检查', '3. 内存空间零值初始化', '4. 设置对象头', '5. 执行构造方法']) {
        const node = nodes.find(node => node.text.startsWith(title));
        assert.ok(node, `${name}: original step number must remain: ${title}`);
        assert.equal(node.lists, 0, `${name}: a numbered step is not a list`);
        assert.equal(node.lines, 2, `${name}: respect explicit newline without premature wrapping: ${JSON.stringify(node)}`);
        assert.ok(Math.abs(node.center) < 2, `${name}: keep node text vertically centered`);
      }
      assert.ok(nodes.find(node=>node.text==='执行 new 指令').width < 150, 'short nodes should remain compact');
    }
    return nodes;
  }
  for (const dark of [false, true]) {
    await page.evaluate(async ({source,dark}) => {
      document.body.style.background = dark ? '#202124' : '#fff';
      document.querySelector('#out').innerHTML = (await window.fixture.renderMermaid(source,dark)).svg;
    }, {source,dark});
    await check(dark ? 'dark' : 'light');
    if (dark) {
      await page.locator('.node').filter({hasText:'1. 类加载检查'}).screenshot({path:`${output}/class-loading-detail.png`});
      await page.locator('.node').filter({hasText:'3. 内存空间零值初始化'}).screenshot({path:`${output}/zero-init-detail.png`});
    }
  }
  await page.evaluate(async () => {
    const source = 'flowchart TD\nA["' + '说明文字'.repeat(25) + '"]\nB["3. **加粗步骤**<br/>(说明)"]\nC["3. 第一项<br/>4. 第二项"]\nD["- 第一项<br/>- 第二项"]';
    document.querySelector('#out').innerHTML=(await window.fixture.renderMermaid(source,false)).svg;
  });
  const extra = await check('long-and-lists', false);
  assert.ok(extra[0].lines > 1 && extra[0].width <= 481, 'very long labels must still wrap within the width limit');
  assert.ok(/^3\.\s*加粗步骤/.test(extra[1].text) && !extra[1].lists && extra[1].bold, `numbered steps can retain inline formatting: ${JSON.stringify(extra[1])}`);
  assert.ok(extra[2].lists && extra[3].lists, 'actual ordered and unordered lists remain lists');
  const rust = await readFile('src-tauri/src/core/mermaid.rs','utf8');
  const template = rust.match(/r#"(<!doctype html>[\s\S]*?)"#/)[1];
  const values = {source_json:JSON.stringify(source), script_url:`${base}/src-tauri/resources/mermaid/mermaid.min.js`,
    renderer_config:Buffer.from(await readFile('src/lib/mermaid-config.js')).toString('base64'),
    markdown_renderer:Buffer.from(await readFile('src-tauri/resources/mermaid/markdown-labels.js')).toString('base64'),
    themes_json:JSON.stringify({light:'redux-color',dark:'redux-dark-color',diagrams:{}}), node_spacing:'50', rank_spacing:'60'};
  let html = '';
  await page.route('**/node-width-export', route=>route.fulfill({contentType:'text/html',body:html}));
  for (const mode of ['png','svg']) {
    const fields = {...values,html_labels:String(mode==='png')};
    html = template.replaceAll('{{','{').replaceAll('}}','}')
      .replace(/\{(source_json|script_url|renderer_config|markdown_renderer|themes_json|html_labels|node_spacing|rank_spacing)\}/g,(_,key)=>fields[key]);
    await page.goto(`${base}/node-width-export`);
    await page.waitForFunction(()=>['ready','error'].includes(document.body.dataset.state));
    assert.equal(await page.locator('body').getAttribute('data-state'),'ready',await page.locator('body').getAttribute('data-error'));
    if(mode==='svg') await page.evaluate(()=>{
      document.querySelector('#diagram').innerHTML=new TextDecoder().decode(Uint8Array.from(atob(document.body.dataset.svgBase64),c=>c.charCodeAt(0)));
    });
    await check(`word-${mode}`);
  }
  console.log('PASS: numbered node labels retain numbers, explicit two-line content, compact short nodes and vertical centering in light/dark previews and Word PNG/SVG.');
} finally { await browser.close(); }
