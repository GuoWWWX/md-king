import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  await page.goto("http://127.0.0.1:1420/tests/browser/mermaid-sequence-dark.html");
  await page.waitForFunction(() => window.result?.svg);
  const result = await page.evaluate(() => ({
    messageText: [...document.querySelectorAll(".messageText")].map((node) => getComputedStyle(node).fill),
    messageLines: [...document.querySelectorAll(".messageLine0, .messageLine1, .actor-line, .innerArc")].map((node) => getComputedStyle(node).stroke),
    arrowheads: [...document.querySelectorAll('[id$="-arrowhead"] path, [id$="-crosshead"] path')].map((node) => ({ fill: getComputedStyle(node).fill, stroke: getComputedStyle(node).stroke })),
    notes: [...document.querySelectorAll(".noteText")].map((node) => getComputedStyle(node).fill),
    actorLabels: [...document.querySelectorAll("text.actor tspan")].map((node) => getComputedStyle(node).fill),
  }));
  assert.ok(result.messageText.length >= 6, `expected sequence messages, got ${result.messageText.length}`);
  assert.ok(result.messageText.every((color) => color === "rgb(212, 212, 216)"), `message text is not light gray: ${JSON.stringify(result.messageText)}`);
  assert.ok(result.messageLines.length >= 8, `expected sequence lines, got ${result.messageLines.length}`);
  assert.ok(result.messageLines.every((color) => color === "rgb(161, 161, 170)"), `sequence lines are too dark: ${JSON.stringify(result.messageLines)}`);
  assert.ok(result.arrowheads.length >= 2 && result.arrowheads.every(({ fill, stroke }) => fill === "rgb(212, 212, 216)" && stroke === "rgb(212, 212, 216)"), `sequence arrows are too dark: ${JSON.stringify(result.arrowheads)}`);
  assert.ok(result.notes.every((color) => color === "rgb(0, 0, 0)"), `note text should stay dark on yellow notes: ${JSON.stringify(result.notes)}`);
  assert.ok(result.actorLabels.every((color) => color === "rgb(0, 0, 0)"), `actor labels should stay dark on light participant boxes: ${JSON.stringify(result.actorLabels)}`);
  await page.locator("#out").screenshot({ path: ".codex/sequence-dark-readable.png" });
  console.log("PASS: dark sequence diagram text, lines and arrows are readable.");
} finally {
  await browser.close();
}
