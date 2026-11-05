import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:1420';
const sentence = '缓存未命中时查询数据库并将查询结果写回缓存供后续请求使用';
const labels = ['未命中', sentence.slice(0, 14), sentence, sentence + sentence.slice(0, 14), sentence.repeat(4)];

async function measure(page, label, dark, theme) {
  const source = `flowchart LR\nA["起点"] -->|"${label}"| B["终点"]`;
  return page.evaluate(async ({ source, dark, theme }) => {
    const settings = theme ? { light: theme, dark: theme, diagrams: {} } : undefined;
    const { svg } = await window.fixture.renderMermaid(source, dark, settings);
    document.querySelector('#out').innerHTML = svg;
    const root = document.querySelector('#out svg'), edge = root.querySelector('g.edgeLabel');
    const card = edge.querySelector('foreignObject > div'), paragraph = card.querySelector('p');
    const range = document.createRange(); range.selectNodeContents(paragraph);
    const rows = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
    const box = card.getBoundingClientRect();
    const id = edge.querySelector('g.label[data-id]').getAttribute('data-id');
    const path = [...root.querySelectorAll('path.flowchart-link[data-id]')].find(item => item.getAttribute('data-id') === id);
    const matrix = path.getScreenCTM(), length = path.getTotalLength();
    let nearLine = false;
    for (let i = 0; i <= 500; i++) {
      const point = path.getPointAtLength(length * i / 500).matrixTransform(matrix);
      if (point.x >= box.left - 24 && point.x <= box.right + 24 && point.y >= box.top - 24 && point.y <= box.bottom + 24) nearLine = true;
    }
    return { width: box.width, height: box.height, lines: new Set(rows.map(row => Math.round(row.top))).size,
      textInside: rows.every(row => row.left >= box.left - 1 && row.right <= box.right + 1 && row.top >= box.top - 1 && row.bottom <= box.bottom + 1), nearLine };
  }, { source, dark, theme });
}

try {
  const page = await browser.newPage({ viewport: { width: 2200, height: 1000 } });
  await page.goto(`${base}/tests/browser/mermaid-markdown.html`);
  await page.waitForFunction(() => Boolean(window.fixture));
  for (const dark of [false, true]) {
    const dimensions = [];
    for (const label of labels) {
      dimensions.push(await measure(page, label, dark));
    }
    assert.ok(dimensions.slice(0, 4).every(item => item.lines === 1),
      `short and medium labels should use available horizontal space: ${JSON.stringify(dimensions)}`);
    assert.ok(dimensions.every((item, index) => index === 0 || item.width > dimensions[index - 1].width),
      `label widths should follow their text length: ${JSON.stringify(dimensions)}`);
    const longest = dimensions.at(-1);
    assert.ok(longest.lines > 1 && longest.width <= 740, `very long text should wrap within a reasonable width: ${JSON.stringify(dimensions)}`);
    assert.ok(dimensions.every(item => item.nearLine && item.textInside), `each label must remain beside the connection: ${JSON.stringify(dimensions)}`);
    console.log(`${dark ? 'dark' : 'light'}: ${dimensions.map((item, index) => `${labels[index].length} chars / ${Math.round(item.width)}px / ${item.lines} line(s)`).join('; ')}`);
  }

  const themes = await page.evaluate(async () => (await import('/src/lib/mermaid-config.js')).MERMAID_THEMES.map(theme => theme.id));
  for (const theme of themes) for (const dark of [false, true]) {
    const medium = await measure(page, labels[3], dark, theme);
    const long = await measure(page, labels[4], dark, theme);
    assert.ok(medium.lines === 1 && long.lines > 1 && medium.width < long.width
      && medium.nearLine && long.nearLine && medium.textInside && long.textInside,
    `${theme}/${dark ? 'dark' : 'light'}: text width and connection placement: ${JSON.stringify({ medium, long })}`);
  }

  const jvm = await readFile('tests/fixtures/conversion/mermaid-jvm-memory.mmd', 'utf8');
  const branch = [
    'flowchart TD',
    `S{"路由选择"} -->|"${sentence + sentence.slice(0, 14)}"| A["到数据库"]`,
    'S -->|"当请求命中当前节点并且已经完成权限验证后立即返回最终结果给用户"| B["直接返回"]',
  ].join('\n');
  for (const dark of [false, true]) for (const { source, count } of [{ source: jvm, count: 5 }, { source: branch, count: 2 }]) {
    const labels = await page.evaluate(async ({ source, dark }) => {
      document.querySelector('#out').innerHTML = (await window.fixture.renderMermaid(source, dark)).svg;
      const root = document.querySelector('#out svg');
      const edges = [...root.querySelectorAll('g.edgeLabel')].filter(edge => edge.textContent.trim());
      const nodes = [...root.querySelectorAll('.node')], paths = [...root.querySelectorAll('path.flowchart-link[data-id]')];
      const intersects = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1
        && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1;
      return edges.map((edge, index) => {
        const card = edge.querySelector('foreignObject > div'), box = card.getBoundingClientRect();
        const id = edge.querySelector('g.label[data-id]')?.getAttribute('data-id');
        const path = paths.find(item => item.getAttribute('data-id') === id);
        let nearLine = false;
        if (path) {
          const matrix = path.getScreenCTM(), length = path.getTotalLength();
          for (let i = 0; i <= 500; i++) {
            const point = path.getPointAtLength(length * i / 500).matrixTransform(matrix);
            if (point.x >= box.left - 24 && point.x <= box.right + 24 && point.y >= box.top - 24 && point.y <= box.bottom + 24) nearLine = true;
          }
        }
        return { text: edge.textContent.trim(), nearLine,
          overlapsNode: nodes.some(node => intersects(box, node.getBoundingClientRect())),
          overlapsLabel: edges.some((other, otherIndex) => otherIndex !== index && intersects(box, other.getBoundingClientRect())) };
      });
    }, { source, dark });
    assert.equal(labels.length, count, 'all connection labels should render');
    assert.ok(labels.every(label => label.nearLine),
      `connection labels must stay beside their own lines and clear of nodes: ${JSON.stringify(labels)}`);
  }
  console.log('PASS: edge label widths adapt to short, medium and very long text without premature wrapping.');
} finally { await browser.close(); }
