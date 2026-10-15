import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1300 } });
  for (const theme of ["light", "dark"]) {
    await page.goto(`${process.env.TEST_BASE_URL || "http://127.0.0.1:1420"}/tests/browser/caption-format.html?theme=${theme}`);
    for (const text of ["表4-1 仿真测试指标", "图3-1 系统示意图"]) {
      const caption = page.getByText(text, { exact: true });
      await caption.waitFor();
      const style = await caption.evaluate(el => {
        const css = getComputedStyle(el);
        return { tag: el.tagName, align: css.textAlign, size: css.fontSize, weight: css.fontWeight, indent: css.textIndent };
      });
      assert.deepEqual(style, { tag: "DIV", align: "center", size: "14px", weight: "700", indent: "0px" }, `${theme}: ${text}`);
    }
  }
  console.log("PASS: numbered table/image titles across blank lines use centered bold 10.5pt captions with no first-line indent.");
} finally {
  await browser.close();
}
