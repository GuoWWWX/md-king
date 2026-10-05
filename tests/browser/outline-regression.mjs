import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto("http://127.0.0.1:1420/tests/browser/outline-regression.html");
  await page.waitForFunction(() => window.fixture?.view);

  // 1. 获取第 5 章标题的 line 号
  const ch5Line = await page.evaluate(() => {
    return window.fixture.outline.find((item) => item.text.includes("五、混合持久化"))?.line;
  });
  if (!ch5Line) throw new Error("Could not find chapter 5 in outline");

  // 2. 模拟目录点击跳转或平滑滚动：将视口滚动到第 5 章标题处（标题 top 距离视口 24px）
  await page.evaluate((targetLine) => {
    const view = window.fixture.view;
    const pos = view.state.doc.line(targetLine).from;
    const block = view.lineBlockAt(pos);
    view.scrollDOM.scrollTop = Math.max(0, block.top - 24);
  }, ch5Line);

  // 等待事件广播与 RAF
  await page.waitForTimeout(300);

  const eventDetail = await page.evaluate(() => window.lastVisibleEvent);
  console.log("Chapter 5 at top 24px - Event detail:", eventDetail);

  if (eventDetail.activeHeadingLine !== ch5Line) {
    throw new Error(`Expected activeHeadingLine to be ${ch5Line}, but got ${eventDetail.activeHeadingLine}`);
  }

  // 3. 深入第 5 章正文：向下滚动 120px（第 5 章标题滑出视口顶部）
  await page.evaluate((targetLine) => {
    const view = window.fixture.view;
    const pos = view.state.doc.line(targetLine).from;
    const block = view.lineBlockAt(pos);
    view.scrollDOM.scrollTop = block.top + 120;
  }, ch5Line);

  await page.waitForTimeout(300);

  const bodyEventDetail = await page.evaluate(() => window.lastVisibleEvent);
  console.log("Inside Chapter 5 body - Event detail:", bodyEventDetail);

  if (bodyEventDetail.activeHeadingLine !== ch5Line) {
    throw new Error(`Expected activeHeadingLine to stay ${ch5Line} inside chapter body, but got ${bodyEventDetail.activeHeadingLine}`);
  }

  console.log("PASS: Outline active heading strictly matches user reading position with zero offset/rebound!");
} finally {
  await browser.close();
}
