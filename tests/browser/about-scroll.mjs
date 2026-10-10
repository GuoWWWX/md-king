import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1080 } });
  page.on("pageerror", error => console.log(error.message));
  await page.goto("http://127.0.0.1:1420/tests/browser/about-scroll.html");
  const workspace = page.locator(".mk-about-workspace");
  await workspace.waitFor();
  for (const [width, height] of [[1100, 420], [700, 500], [1300, 760]]) {
    await page.evaluate(([width, height]) => {
      const root = document.getElementById("root");
      root.style.width = `${width}px`;
      root.style.height = `${height}px`;
      document.querySelector(".mk-about-workspace").scrollTop = 0;
    }, [width, height]);
    assert.equal(await workspace.evaluate(e => getComputedStyle(e).overflowY), "auto");
    if (await workspace.evaluate(e => e.scrollHeight > e.clientHeight)) {
      await workspace.hover();
      await page.mouse.wheel(0, 2000);
      await page.waitForFunction(() => document.querySelector(".mk-about-workspace").scrollTop > 0);
    }
    await workspace.evaluate(e => e.scrollTop = e.scrollHeight);
    const last = page.locator(".mk-about-guide-row").last();
    assert.ok(await last.evaluate(e => {
      const bottom = e.getBoundingClientRect().bottom;
      return bottom <= document.querySelector(".mk-about-workspace").getBoundingClientRect().bottom + 1;
    }));
  }
  console.log("PASS: About page wheel scrolling and final guide row visibility at three available sizes");
} finally {
  await browser.close();
}
