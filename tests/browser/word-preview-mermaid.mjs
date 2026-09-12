// Start Vite, then run: node tests/browser/word-preview-mermaid.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
try {
  for (const theme of ["dark", "light"]) {
    for (const scenario of ["fit", "move", "large", "consecutive"]) {
      // Fresh page: do not let a cached light SVG hide incorrect dark-size lookups.
      const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
      await page.goto((process.env.TEST_BASE_URL || "http://127.0.0.1:1420") + `/tests/browser/word-preview-mermaid.html?theme=${theme}&scenario=${scenario}`);
      await page.waitForFunction(count => {
        const images = [...document.querySelectorAll('img[alt="Mermaid 图表"]')];
        return images.length === count && images.every(image => image.complete && image.naturalHeight > 0);
      }, scenario === "consecutive" ? 2 : 1);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const pages = await page.evaluate(() => [...document.querySelectorAll("[data-preview-page-index]")].map(page => {
        const paper = page.querySelector('.mk-word-preview-page');
        const bottom = paper.clientHeight - parseFloat(getComputedStyle(paper).paddingBottom);
        return {
          images: page.querySelectorAll('img[alt="Mermaid 图表"]').length,
          following: page.textContent.includes('后续正文'),
          quote: page.textContent.includes('后续引用'),
          second: page.textContent.includes('第二图后文'),
          overflow: [...paper.children].some(child => child.offsetTop + child.offsetHeight > bottom + 1),
        };
      }));
      const empty = { images: 0, following: false, quote: false, second: false, overflow: false };
      const withText = { ...empty, images: 1, following: true, quote: true };
      const expected = scenario === 'fit' ? [withText]
        : scenario === 'move' ? [empty, withText]
        : scenario === 'large' ? [{ ...empty, images: 1 }, { ...empty, following: true, quote: true }]
        : [withText, { ...empty, images: 1, second: true }];
      assert.deepEqual(pages, expected, `${theme} / ${scenario}`);
      await page.close();
    }
  }
  console.log("PASS: light/dark cold render, same-page fit, move-and-reuse, large diagram overflow, consecutive diagrams and following quotes.");
} finally {
  await browser.close();
}
