import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 2048, height: 700 } });
  await mkdir('.codex', { recursive: true });
  for (const theme of ['dark', 'light']) {
    await page.goto(`http://127.0.0.1:1420/tests/browser/mermaid-edge-labels.html?theme=${theme}`);
    await page.waitForFunction(() => window.png);
    const styles = await page.evaluate(() => {
      // Check the actual text elements too: a transparent labelBkg parent does
      // not cancel the flowchart renderer's backgrounds on span.edgeLabel/p.
      const labels = [...document.querySelectorAll('.edgeLabel p')];
      const painted = [...document.querySelectorAll('.edgeLabel, .edgeLabel *')].filter((node) => {
        const style = getComputedStyle(node);
        return style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.backgroundImage !== 'none'
          || (node.tagName === 'rect' && !['none', 'rgba(0, 0, 0, 0)'].includes(style.fill));
      }).map((node) => ({ tag: node.tagName, class: node.getAttribute('class'), background: getComputedStyle(node).backgroundColor }));
      return { text: labels.map((node) => node.textContent), painted,
        colors: labels.map((node) => getComputedStyle(node).color),
        shadows: labels.map((node) => getComputedStyle(node).textShadow) };
    });
    assert.equal(styles.text.length, 4, 'the exact ThreadLocal sample must have four relationship labels');
    assert.deepEqual(styles.painted, [], `${theme}: relationship labels must not paint any rectangular background`);
    assert.ok(styles.shadows.every((shadow) => shadow === 'none'), 'labels must not have a halo');
    assert.equal(styles.colors.filter((color) => color === 'rgb(255, 255, 255)').length, theme === 'dark' ? 1 : 0,
      'only the label over the dark canvas should be white; three labels over the pale cluster must be dark');
    assert.equal(styles.colors.filter((color) => color === 'rgb(34, 34, 34)').length, theme === 'dark' ? 3 : 4,
      'labels over a light background must remain visible without an outline');
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
  console.log('PASS: ThreadLocal flowchart labels have no background in light/dark rendering.');
} finally {
  await browser.close();
}
