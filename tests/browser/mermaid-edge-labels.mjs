import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { contrastRatio } from './contrast-utils.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 2048, height: 700 } });
  await mkdir('.codex', { recursive: true });
  for (const theme of ['dark', 'light']) {
    await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:1420'}/tests/browser/mermaid-edge-labels.html?theme=${theme}`);
    await page.waitForFunction(() => window.png);
    const styles = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('.edgeLabel p')];
      const cards = [...document.querySelectorAll('g.edgeLabel foreignObject > div')];
      return { text: labels.map((node) => node.textContent), cards: cards.map((card) => {
        const style = getComputedStyle(card);
        const label = card.querySelector('p');
        const group = card.closest('g.edgeLabel');
        const id = group.querySelector('g.label[data-id]')?.getAttribute('data-id');
        const path = [...document.querySelectorAll('path.flowchart-link[data-id]')].find(item => item.getAttribute('data-id') === id);
        const box = card.getBoundingClientRect();
        let backdrop = getComputedStyle(document.body).backgroundColor;
        for (const rect of document.querySelectorAll('.cluster > rect')) {
          const b = rect.getBoundingClientRect();
          if (box.left + box.width / 2 >= b.left && box.left + box.width / 2 <= b.right
            && box.top + box.height / 2 >= b.top && box.top + box.height / 2 <= b.bottom) backdrop = getComputedStyle(rect).fill;
        }
        let nearLine = false;
        if (path) {
          const matrix = path.getScreenCTM(), length = path.getTotalLength();
          for (let i = 0; i <= 500; i++) {
            const point = path.getPointAtLength(length * i / 500).matrixTransform(matrix);
            if (point.x >= box.left - 24 && point.x <= box.right + 24 && point.y >= box.top - 24 && point.y <= box.bottom + 24) nearLine = true;
          }
        }
        return { background: style.backgroundColor, border: style.borderTopWidth,
          borderStyle: style.borderTopStyle, borderColor: style.borderTopColor,
          text: getComputedStyle(label).color, fontSize: getComputedStyle(label).fontSize,
          nodeFont: getComputedStyle(document.querySelector('.node .nodeLabel p')).fontSize, backdrop, nearLine };
      }) };
    });
    assert.equal(styles.text.length, 4, 'the exact ThreadLocal sample must have four relationship labels');
    assert.equal(styles.cards.length, 4, `${theme}: every relationship label must render`);
    assert.ok(styles.cards.every(({ background, border, fontSize, nodeFont }) =>
      background === 'rgba(0, 0, 0, 0)' && parseFloat(border) === 0
      && parseFloat(fontSize) === 12 && parseFloat(fontSize) < parseFloat(nodeFont)),
    `${theme}: labels must be transparent, borderless and smaller than nodes: ${JSON.stringify(styles.cards)}`);
    assert.ok(styles.cards.every(({text,backdrop})=>contrastRatio(text,backdrop)>=4.5),
      `${theme}: all labels must contrast with the diagram: ${JSON.stringify(styles.cards)}`);
    assert.ok(styles.cards.every(({nearLine}) => nearLine), `${theme}: each card must stay beside its own line: ${JSON.stringify(styles.cards)}`);
    await page.locator('#out').screenshot({ path: `.codex/mermaid-edge-labels-${theme}.png` });
    // The same CSS must survive serialization/rasterization for preview/export.
    const darkPixels = await page.evaluate(async () => {
      const image = new Image(); image.src = window.png;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const bounds = document.querySelector('#out svg').getBoundingClientRect();
      const scale = canvas.width / bounds.width;
      return [...document.querySelectorAll('.edgeLabel p')].map((label) => {
        const b = label.getBoundingClientRect();
        const pixels = context.getImageData(Math.round((b.left - bounds.left) * scale),
          Math.round((b.top - bounds.top) * scale), Math.ceil(b.width * scale), Math.ceil(b.height * scale)).data;
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] < 80 && pixels[i + 1] < 80 && pixels[i + 2] < 80 && pixels[i + 3] > 200) count++;
        }
        return count;
      });
    });
    assert.ok(darkPixels.every((count) => count > 30), `all four labels must have visible text on the white PNG canvas: ${darkPixels}`);
  }
  const samples = [
    `flowchart LR
      subgraph H["新生代"]
        Eden["Eden 区"] -->|"划分专属工位"| T1["TLAB 1 (专供线程1无锁分配)"]
        Eden -->|"划分专属工位"| T2["TLAB 2 (专供线程2无锁分配)"]
        Eden -->|"划分专属工位"| T3["TLAB 3 (专供线程3无锁分配)"]
      end`,
    `flowchart TD
      Eden["Eden 区"] -->|"条件1: 年龄达到阈值 (Age >= 15)"| Old["直接晋升【老年代】"]
      S0["Survivor S0"] -->|"条件2: 动态年龄判定 (累积 > 50%)"| Old
      S1["Survivor S1"] -->|"条件3: 幸存区放不下 (分配担保溢出)"| Old
      S1 -->|"都不满足 (正常幸存且放得下)"| To["整齐复制到【Survivor To 区】"]`,
  ];
  for (const dark of [false, true]) for (const source of samples) {
    const result = await page.evaluate(async ({source, dark}) => {
      const {renderMermaid} = await import('/src/lib/mermaid.ts');
      document.querySelector('#out').innerHTML = (await renderMermaid(source, dark)).svg;
      const root = document.querySelector('#out svg');
      const labels = [...root.querySelectorAll('g.edgeLabel')];
      return {
        edgeFonts: labels.map(label => parseFloat(getComputedStyle(label.querySelector('p')).fontSize)),
        nodeFonts: [...root.querySelectorAll('.node .nodeLabel p')].map(node => parseFloat(getComputedStyle(node).fontSize)),
        opaqueBlocks: labels.flatMap(label => [...label.querySelectorAll('div,span,p')])
          .filter(node => getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)').length,
        visibleRects: labels.flatMap(label => [...label.querySelectorAll('rect')])
          .filter(rect => !['none', 'rgba(0, 0, 0, 0)'].includes(getComputedStyle(rect).fill) || getComputedStyle(rect).stroke !== 'none').length,
      };
    }, {source, dark});
    assert.equal(result.opaqueBlocks, 0, 'label backgrounds must not hide neighboring connectors');
    assert.equal(result.visibleRects, 0, 'native SVG label rectangles must be invisible');
    assert.ok(result.edgeFonts.length >= 3 && result.edgeFonts.every(font => font === 12 && result.nodeFonts.every(nodeFont => nodeFont > font)),
      `TLAB and GC labels must actually be smaller than nodes: ${JSON.stringify(result)}`);
  }
  console.log('PASS: ThreadLocal, TLAB and GC labels are transparent, borderless and smaller than node text.');
} finally {
  await browser.close();
}
