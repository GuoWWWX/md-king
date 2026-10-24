import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import english from "../locales/en.json" with { type: "json" };
import { getLanguage, normalizeLanguage, setLanguage, subscribeLanguage, translate } from "./i18n.ts";
import { templateLabel } from "./template-labels.ts";

test("UI language accepts supported locales and safely defaults to Chinese", () => {
  assert.equal(normalizeLanguage("en"), "en");
  assert.equal(normalizeLanguage("zh"), "zh");
  for (const value of [undefined, null, "fr", "EN", ""]) assert.equal(normalizeLanguage(value), "zh");
});

test("language changes notify subscribers and preserve user template names", () => {
  const previous = getLanguage();
  const changes: string[] = [];
  const unsubscribe = subscribeLanguage(() => changes.push(getLanguage()));
  try {
    setLanguage("zh");
    changes.length = 0;
    setLanguage("en");
    setLanguage("en");
    assert.deepEqual(changes, ["en"]);
    assert.equal(templateLabel({ name: "默认报告模板", isBuiltIn: true }), "Default report template");
    assert.equal(templateLabel({ name: "设置", isBuiltIn: false }), "设置");
    assert.equal(templateLabel({ name: "Default report template", isBuiltIn: false }), "Default report template");
    setLanguage("zh");
    assert.equal(templateLabel({ name: "默认报告模板", isBuiltIn: true }), "默认报告模板");
    unsubscribe();
    setLanguage("en");
    assert.deepEqual(changes, ["en", "zh"]);
  } finally { unsubscribe(); setLanguage(previous); }
});

test("all English messages preserve parameters and static application keys have translations", () => {
  const dictionary: Record<string, string> = english;
  const parameters = (value: string) => [...value.matchAll(/\{\d+\}/g)].map((match) => match[0]).sort();
  for (const [key, value] of Object.entries(dictionary)) {
    assert.ok(value.trim(), key);
    assert.deepEqual(parameters(value), parameters(key), key);
  }
  const root = fileURLToPath(new URL("../", import.meta.url));
  for (const file of globSync("**/*.{ts,tsx}", { cwd: root })) {
    if (file.endsWith(".test.ts")) continue;
    const source = ts.createSourceFile(file, readFileSync(new URL(file.replace(/\\/g, "/"), new URL("../", import.meta.url)), "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t") {
        const key = node.arguments[0];
        if (key && ts.isStringLiteral(key) && /[\u4e00-\u9fff]/.test(key.text)) assert.ok(dictionary[key.text], `${file}: ${key.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
});

test("translations support live language changes, parameters, and literal fallback", () => {
  assert.equal(translate("设置", "en"), "Settings");
  assert.equal(translate("设置", "zh"), "设置");
  assert.equal(translate("关闭 {0}", "en", ["用户自己的文档.md"]), "Close 用户自己的文档.md");
  assert.equal(translate("关闭 {0}", "zh", ["{1}.md"]), "关闭 {1}.md");
  assert.equal(translate("User document: [中文] **body**", "en"), "User document: [中文] **body**");
  assert.equal(translate("关闭 {0}", "en"), "Close {0}");
});
