import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1300 } });
  for (const numbering of ["source", "auto"]) {
    for (const theme of ["light", "dark"]) {
      await page.goto(`${process.env.TEST_BASE_URL || "http://127.0.0.1:1420"}/tests/browser/caption-format.html?theme=${theme}&numbering=${numbering}`);
      const titles = numbering === "auto"
        ? ["表 1 仿真测试指标", "表 2 附录权限矩阵", "图 1.1 系统示意图", "图 1.2 附录系统图"]
        : ["表4-1 仿真测试指标", "表A-1 附录权限矩阵", "图3-1 系统示意图", "图A-1 附录系统图"];
      for (const text of titles) {
        const caption = page.getByText(text, { exact: true });
        await caption.waitFor();
        const style = await caption.evaluate(el => {
          const css = getComputedStyle(el);
          return { tag: el.tagName, align: css.textAlign, size: css.fontSize, weight: css.fontWeight, indent: css.textIndent };
        });
        assert.deepEqual(style, { tag: "DIV", align: "center", size: "14px", weight: "700", indent: "0px" }, `${numbering}/${theme}: ${text}`);
      }
    }
  }
  console.log("PASS: source captions are preserved; explicitly enabled numbering uses configured sequential formats; all captions are centered bold 10.5pt without first-line indent in light/dark themes.");
} finally {
  await browser.close();
}
