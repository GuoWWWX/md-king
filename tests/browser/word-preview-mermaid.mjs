// Start Vite, then run: node tests/browser/word-preview-mermaid.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.goto((process.env.TEST_BASE_URL || "http://127.0.0.1:1420") + "/tests/browser/word-preview-mermaid.html");
  await page.waitForFunction(() => document.querySelectorAll("[data-preview-page-index]").length >= 2);
  await page.waitForFunction(() => document.querySelectorAll('img[alt="Mermaid 图表"]').length === 1);
  const pages = await page.evaluate(() => [...document.querySelectorAll("[data-preview-page-index]")].map((page) => ({
    index: page.dataset.previewPageIndex,
    hasMermaid: Boolean(page.querySelector('img[alt="Mermaid 图表"]')),
    hasFollowingText: page.textContent?.includes("后续正文"),
  })));
  assert.deepEqual(pages, [
    { index: "1", hasMermaid: false, hasFollowingText: false },
    { index: "2", hasMermaid: true, hasFollowingText: true },
  ]);
  console.log("PASS: Mermaid uses its measured height, moves only when needed, and following text reuses remaining space.");
} finally {
  await browser.close();
}
