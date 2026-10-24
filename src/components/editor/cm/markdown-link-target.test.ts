import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { markdownLinkTarget } from "./markdown-link-target.ts";

const stateFor = (doc: string) => EditorState.create({ doc, extensions: [markdown()] });
function targets(state: EditorState, nodeName = "Link") {
  const result: Array<string | undefined> = [];
  syntaxTree(state).iterate({ enter(node) {
    if (node.name !== nodeName) return;
    result.push(markdownLinkTarget(state, node.node));
    return false;
  } });
  return result;
}

test("undefined brackets stay literal while inline and reference links resolve", () => {
  const state = stateFor('[da] [说明] [空缺][missing] [未定义][] [内联](https://example.com/inline) [空]()\n\n[显示][Site] [site][] [SITE]\n\n[site]: https://example.com/reference');
  assert.deepEqual(targets(state), [undefined, undefined, undefined, undefined, 'https://example.com/inline', '', ...Array(3).fill('https://example.com/reference')]);
});

test("image references and empty destinations resolve only when Markdown recognizes them", () => {
  const state = stateFor('![图片](photo.png) ![引用][asset] ![asset][] ![asset] ![缺失][missing] ![]()\n\n[asset]: photo.png');
  assert.deepEqual(targets(state, "Image"), ['photo.png', 'photo.png', 'photo.png', 'photo.png', undefined, '']);
});

test("rejected destinations are literal instead of recognized links or images", () => {
  const state = stateFor('[链接](javascript:alert) ![图片](javascript:alert)');
  assert.deepEqual(targets(state), [undefined]);
  assert.deepEqual(targets(state, "Image"), [undefined]);
});

test("link destinations use Markdown escaping, angle delimiters and autolink normalization", () => {
  assert.deepEqual(targets(stateFor(String.raw`[空格](<target document.md#L2>) [括号](target\(1\).md) [实体](target&amp;one.md)`)), ['target%20document.md#L2', 'target(1).md', 'target&one.md']);
  assert.deepEqual(targets(stateFor('<https://example.com> <user@example.com>'), 'Autolink'), ['https://example.com', 'mailto:user@example.com']);
  assert.deepEqual(targets(stateFor('![图片](<figure one.png>)'), 'Image'), ['figure%20one.png']);
});
test("reference definitions follow Markdown rules and are refreshed after edits", () => {
  let state = stateFor('[动态] [代码定义]\n\n```markdown\n[代码定义]: https://example.com/code\n```');
  assert.deepEqual(targets(state), [undefined, undefined]);
  state = state.update({ changes: { from: state.doc.length, insert: '\n\n[动态]: https://example.com/live' } }).state;
  assert.deepEqual(targets(state), ['https://example.com/live', undefined]);
  state = state.update({ changes: { from: state.doc.toString().lastIndexOf('\n\n[动态]:'), to: state.doc.length } }).state;
  assert.deepEqual(targets(state), [undefined, undefined]);
});
