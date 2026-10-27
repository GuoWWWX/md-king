import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({channel: 'msedge', headless: true});
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:1420';
const source = 'flowchart LR\nsubgraph G["**组标题**"]\nA["**粗体** *斜体* `代码` $x^2$<br/>- 第一项<br/>- 第二项"] -->|"**连线** `id`"| B["1. 一项<br/>2. 二项"]\nend';
try {
  const page = await browser.newPage({viewport: {width: 1400, height: 1000}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/tests/browser/mermaid-markdown.html`);
  await page.waitForFunction(() => window.fixture);
  for (const dark of [false, true]) {
    const result = await page.evaluate(async ({source, dark}) => {
      document.documentElement.classList.toggle('dark', dark);
      document.body.style.background = dark ? '#202124' : '#ffffff';
      const rendered = await window.fixture.renderMermaid(source, dark);
      const host = document.querySelector('#out'); host.innerHTML = rendered.svg;
      const svg = host.querySelector('svg');
      const a = [...svg.querySelectorAll('.node')].find(node => node.textContent.includes('粗体'));
      const b = svg.querySelector('.node[id*="flowchart-B-"]');
      const ul = a?.querySelector('ul'), ol = b?.querySelector('ol');
      const paragraph = ul?.previousElementSibling;
      const boxes = [...svg.querySelectorAll('foreignObject')].map(fo => ({height: Number(fo.getAttribute('height')), content: fo.firstElementChild?.scrollHeight || 0}));
      const png = await window.fixture.mermaidToPngDataUrl(source, dark);
      const image = new Image(); image.src = png; await image.decode();
      return {ids: [...svg.querySelectorAll('.node')].map(node => node.id), strong: a?.querySelector('strong')?.textContent, italic: a?.querySelector('em')?.textContent,
        code: a?.querySelector('code')?.textContent, formula: a?.querySelector('math msup')?.textContent,
        bullets: ul?.querySelectorAll('li').length, numbers: ol?.querySelectorAll('li').length,
        bulletStyle: ul && getComputedStyle(ul).listStyleType, numberStyle: ol && getComputedStyle(ol).listStyleType,
        listBelowText: Boolean(paragraph && ul && ul.getBoundingClientRect().top >= paragraph.getBoundingClientRect().bottom - 1),
        title: svg.querySelector('.cluster-label strong')?.textContent,
        edge: svg.querySelector('.edgeLabel strong')?.textContent,
        boxes, pngWidth: image.naturalWidth, pngHeight: image.naturalHeight};
    }, {source, dark});
    assert.equal(result.strong, '粗体'); assert.equal(result.italic, '斜体');
    assert.equal(result.code, '代码'); assert.equal(result.formula, 'x2');
    assert.equal(result.bullets, 2, JSON.stringify(result)); assert.equal(result.numbers, 2, JSON.stringify(result));
    assert.equal(result.bulletStyle, 'disc'); assert.equal(result.numberStyle, 'decimal');
    assert.equal(result.listBelowText, true, 'A list mixed with math must follow the paragraph');
    assert.equal(result.title, '组标题'); assert.equal(result.edge, '连线');
    for (const box of result.boxes) assert.ok(box.content <= box.height + 2, `text must fit: ${JSON.stringify(box)}`);
    assert.ok(result.pngWidth > 100 && result.pngHeight > 100, 'PNG export must decode');
    await page.locator('#out').screenshot({path: `.codex/mermaid-markdown-${dark ? 'dark' : 'light'}.png`});
  }
  const mindmap = await page.evaluate(async () => {
    const source = 'mindmap\n root["**主题** *斜体* `代码` $x^2$<br/>- 一<br/>- 二"]\n  branch["1. 第一<br/>2. 第二"]';
    const result = await window.fixture.renderMermaid(source, false);
    const host = document.querySelector('#out'); host.innerHTML = result.svg;
    const svg = host.querySelector('svg');
    return {strong: svg.querySelector('strong')?.textContent, italic: svg.querySelector('em')?.textContent,
      code: svg.querySelector('code')?.textContent, formula: svg.querySelector('math msup')?.textContent,
      bullets: svg.querySelectorAll('ul li').length, numbers: svg.querySelectorAll('ol li').length};
  });
  assert.deepEqual(mindmap, {strong: '主题', italic: '斜体', code: '代码', formula: 'x2', bullets: 2, numbers: 2});
  await page.locator('#out').screenshot({path: '.codex/mermaid-markdown-mindmap.png'});
  const hostile = await page.evaluate(async () => {
    window.__mermaidExecuted = false;
    const source = 'flowchart LR\n A["**Safe** <img src=x onerror=window.__mermaidExecuted=true>"]';
    const result = await window.fixture.renderMermaid(source, false);
    const host = document.querySelector('#out'); host.innerHTML = result.svg;
    await new Promise(resolve => setTimeout(resolve, 50));
    return {executed: window.__mermaidExecuted, dangerous: host.querySelector('[onerror],script') !== null};
  });
  assert.deepEqual(hostile, {executed: false, dangerous: false}, 'HTML embedded in labels must remain sanitized');
  const parity = await page.evaluate(async (source) => {
    const frontend = await import('/src/lib/mermaid-markdown.ts');
    const offline = await import('/src-tauri/resources/mermaid/markdown-labels.js');
    return [frontend.prepareMermaidMarkdown(source), offline.prepareMermaidMarkdown(source)];
  }, source);
  assert.deepEqual(parity[0], parity[1], 'Offline conversion must use the same label processing as the editor');
  assert.deepEqual(errors, []);
  console.log('PASS: Markdown labels, node/edge/subgraph layout, list markers and math render in light/dark and PNG.');
} finally { await browser.close(); }
