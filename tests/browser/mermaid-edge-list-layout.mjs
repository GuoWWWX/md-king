import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:1420';
const browser = await chromium.launch({ channel: 'msedge', headless: true });

const items = Array.from({ length: 6 }, (_, i) => `${i + 1}. ${'长'.repeat(30)}，处理条件详细说明`);
const sources = ['\\n', '<br/>'].flatMap(separator => [false, true].map(grouped => [
  'flowchart TD',
  ...(grouped ? ['subgraph G["场景"]'] : []),
  `B{"存活去向分流决策"} -->|"${['【晋升老年代】条件', ...items].join(separator)}"| N["直接搬迁至老年代"]`,
  'B -->|"留存"| K["复制到新生代"]',
  ...(grouped ? ['end'] : []),
].join('\n')));

async function geometry(page) {
  return page.evaluate(() => {
    const root = document.querySelector('svg');
    const label = [...root.querySelectorAll('g.edgeLabel')].find(element => element.textContent.includes('晋升老年代'));
    const node = [...root.querySelectorAll('.node')].find(element => element.textContent.includes('直接搬迁'));
    const content = label?.querySelector('foreignObject')?.firstElementChild;
    const rect = element => element?.getBoundingClientRect().toJSON();
    const id = label?.querySelector('g.label[data-id]')?.getAttribute('data-id');
    const path = [...root.querySelectorAll('path.flowchart-link[data-id]')].find(element => element.getAttribute('data-id') === id);
    const box = content?.getBoundingClientRect();
    let nearLine = false;
    if (path && box) {
      const matrix = path.getScreenCTM(), length = path.getTotalLength();
      for (let i = 0; i <= 500; i++) {
        const point = path.getPointAtLength(length * i / 500).matrixTransform(matrix);
        if (point.x >= box.left - 24 && point.x <= box.right + 24 && point.y >= box.top - 24 && point.y <= box.bottom + 24) nearLine = true;
      }
    }
    return { label: rect(label), content: rect(content), node: rect(node), items: [...label.querySelectorAll('ol li')].map(rect), nearLine };
  });
}

function assertGeometry(result) {
  assert.equal(result.items.length, items.length, 'all numbered conditions should remain a list');
  assert.ok(result.items.every(item => item.top >= result.content.top - 1 && item.bottom <= result.content.bottom + 1),
    `list text must remain complete: ${JSON.stringify(result)}`);
  assert.ok(result.nearLine, `edge label must stay beside its connection: ${JSON.stringify(result)}`);
}

try {
  const page = await browser.newPage({ viewport: { width: 2000, height: 2000 } });
  await page.goto(`${base}/tests/browser/mermaid-markdown.html`);
  await page.waitForFunction(() => Boolean(window.fixture));

  for (const dark of [false, true]) for (const source of sources) {
    await page.evaluate(async ({ source, dark }) => {
      const { svg } = await window.fixture.renderMermaid(source, dark);
      document.querySelector('#out').innerHTML = svg;
    }, { source, dark });
    assertGeometry(await geometry(page));
  }

  const tick = String.fromCharCode(96);
  const mixed = 'flowchart TD\nA -->|"公式 $\\nu$\\n1. 计算 $x^2$\\n2. 使用 ' + tick + '\\n' + tick + '"| B';
  const rich = await page.evaluate(async source => {
    document.querySelector('#out').innerHTML = (await window.fixture.renderMermaid(source, false)).svg;
    const edge = document.querySelector('g.edgeLabel');
    return { text: edge.textContent, items: edge.querySelectorAll('ol li').length, code: edge.querySelector('code')?.textContent };
  }, mixed);
  assert.ok(rich.text.includes('ν'), 'LaTeX commands must remain intact');
  assert.equal(rich.items, 2, 'mixed Markdown lists must render');
  assert.equal(rich.code, '\\n', 'inline code must retain a literal backslash and n');

  // The native Word renderer loads a bundled copy of the same Markdown code.
  const rust = await readFile('src-tauri/src/core/mermaid.rs', 'utf8');
  const template = rust.match(/r#"(<!doctype html>[\s\S]*?)"#/)[1];
  const shared = Buffer.from(await readFile('src/lib/mermaid-config.js')).toString('base64');
  const renderer = Buffer.from(await readFile('src-tauri/resources/mermaid/markdown-labels.js')).toString('base64');
  let html = '';
  await page.route('**/edge-list-export-test', route => route.fulfill({ contentType: 'text/html', body: html }));
  for (const mode of ['png', 'svg']) {
    const values = { source_json: JSON.stringify(sources[0]), script_url: `${base}/src-tauri/resources/mermaid/mermaid.min.js`,
      renderer_config: shared, markdown_renderer: renderer, themes_json: JSON.stringify({ light: 'default', dark: 'dark', diagrams: {} }),
      html_labels: String(mode === 'png'), node_spacing: '50', rank_spacing: '60' };
    html = template.replaceAll('{{', '{').replaceAll('}}', '}')
      .replace(/\{(source_json|script_url|renderer_config|markdown_renderer|themes_json|html_labels|node_spacing|rank_spacing)\}/g, (_, name) => values[name]);
    await page.goto(`${base}/edge-list-export-test`);
    await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state));
    assert.equal(await page.locator('body').getAttribute('data-state'), 'ready', await page.locator('body').getAttribute('data-error'));
    assert.equal(await page.locator('body').getAttribute('data-rich-labels'), 'true');
    if (mode === 'svg') await page.evaluate(() => {
      const bytes = Uint8Array.from(atob(document.body.dataset.svgBase64), char => char.charCodeAt(0));
      document.querySelector('#diagram').innerHTML = new TextDecoder().decode(bytes);
    });
    assertGeometry(await geometry(page));
  }
  console.log('PASS: multiline Mermaid edge lists stay complete, beside their connection at their native locations in preview and Word export.');
} finally {
  await browser.close();
}
