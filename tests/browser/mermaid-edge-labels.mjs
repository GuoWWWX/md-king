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
      return { text: labels.map((node) => node.textContent), painted };
    });
    assert.equal(styles.text.length, 4, 'the exact ThreadLocal sample must have four relationship labels');
    assert.deepEqual(styles.painted, [], `${theme}: relationship labels must not paint any rectangular background`);
    await page.locator('#out').screenshot({ path: `.codex/mermaid-edge-labels-${theme}.png` });
    // The same CSS must survive serialization/rasterization for preview/export.
    const imageLoaded = await page.evaluate(async () => {
      const image = new Image(); image.src = window.png;
      await image.decode(); return image.naturalWidth > 0 && image.naturalHeight > 0;
    });
    assert.ok(imageLoaded, 'the diagram must remain rasterizable');
  }
  console.log('PASS: ThreadLocal flowchart labels have no background in light/dark rendering.');
} finally {
  await browser.close();
}
