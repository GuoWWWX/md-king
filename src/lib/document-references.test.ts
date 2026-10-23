import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentReference, referenceLineLabel, referencePathCandidates, resolveDocumentReference, stripReferenceMetadata } from "./document-references.ts";
import { loadDocumentReference } from "./reference-document-loader.ts";
import { parseTableInlineMarkdown } from "../components/editor/cm/table-inline-renderer.ts";

test("章节引用选择整个章节及子章节，遇到同级标题结束", () => {
  const source = "# 开头\n正文\n## 部署\n内容\n### 子章节\n子内容\n## 下节\n其他";
  const range = resolveDocumentReference(source, "file.md#部署")!;
  assert.equal(source.slice(range.from, range.to), "## 部署\n内容\n### 子章节\n子内容");
  assert.equal(referenceLineLabel(range), "line 3-6");
  assert.equal(resolveDocumentReference("# 重复\n甲\n# 重复\n乙", "#重复-1")?.startLine, 3);
});

test("显式行范围严格检查边界，并支持 CRLF 和中文 UTF-16 位置", () => {
  const source = "第一行\r\n👌 第二行\r\n第三行";
  const range = resolveDocumentReference(source, "#L2-L3")!;
  assert.equal(source.slice(range.from, range.to), "👌 第二行\r\n第三行");
  for (const target of ["#L0", "#L3-L2", "#L2-L9"]) assert.equal(resolveDocumentReference(source, target), undefined);
});

test("段落 ID 定位多行段落、独立 ID 和列表条目，拒绝重复和代码示例", () => {
  const source = "开头\n\n第一行\n第二行 ^rule\n\n末尾";
  const range = resolveDocumentReference(source, "#^rule")!;
  assert.equal(source.slice(range.from, range.to), "第一行\n第二行");
  assert.equal(resolveDocumentReference("正文\n\n^one", "#^one")?.startLine, 1);
  assert.equal(resolveDocumentReference("- 第一项\n- 第二项 ^two", "#^two")?.startLine, 2);
  assert.equal(resolveDocumentReference("甲 ^id\n\n乙 ^id", "#^id"), undefined);
  assert.equal(resolveDocumentReference("```\n示例 ^id\n```", "#^id"), undefined);
  assert.equal(resolveDocumentReference("^id", "#^id"), undefined);
  const quoted = "> 前段\n>\n> 目标第一行\n> 第二行 ^quote";
  const quotedRange = resolveDocumentReference(quoted, "#^quote")!;
  assert.equal(quoted.slice(quotedRange.from, quotedRange.to), "> 目标第一行\n> 第二行");
});

test("复制行范围后插入前置内容，稳定引用更新到当前行号", () => {
  const source = "开头\n第一行\n第二行\n末尾";
  const result = createDocumentReference(source, 3, source.indexOf("末尾"), "lines", "notes/file.md", "range-id");
  let anchored = source;
  for (const change of [...result.changes].reverse()) anchored = anchored.slice(0, change.from) + change.insert + anchored.slice(change.to);
  assert.equal(stripReferenceMetadata(anchored), source);
  const range = resolveDocumentReference("新增\n" + anchored, result.reference.slice(2).split("|", 1)[0])!;
  assert.equal(referenceLineLabel(range), "line 3-4");
  assert.equal(stripReferenceMetadata(("新增\n" + anchored).slice(range.from, range.to)), "第一行\n第二行");
});

test("单行范围标识顺序可解析，段落引用复用标识，代码与表格不插入元数据", () => {
  const result = createDocumentReference("正文", 0, 2, "lines", undefined, "single");
  let value = "正文";
  for (const change of [...result.changes].reverse()) value = value.slice(0, change.from) + change.insert + value.slice(change.to);
  assert.equal(resolveDocumentReference(value, "#^single")?.endLine, 1);
  assert.equal(createDocumentReference("段落 ^id", 0, 2, "paragraph").changes.length, 0);
  assert.equal(createDocumentReference("```\n代码\n```", 4, 6, "lines").changes.length, 0);
  assert.equal(createDocumentReference("| a | b |\n|---|---|", 0, 3, "lines").changes.length, 0);
});

test("元数据隐藏与导出保持代码示例和真实内容", () => {
  const code = "```md\n正文 ^id\n<!--md-king:range id:start-->\n```";
  assert.equal(stripReferenceMetadata(code), code);
  assert.equal(stripReferenceMetadata("**正文** ^id\n<!--md-king:range id:end-->"), "**正文**\n");
});

test("路径支持仓库根路径、相对路径、中文编码，并拒绝越界和外部协议", () => {
  assert.deepEqual(referencePathCandidates("/docs/说明.md#L2", "notes/a.md"), ["docs/说明.md"]);
  assert.equal(referencePathCandidates("../%E8%AF%B4%E6%98%8E.md", "notes/a.md")[0], "说明.md");
  assert.deepEqual(referencePathCandidates("../../escape.md", "notes/a.md"), []);
  assert.deepEqual(referencePathCandidates("https://example.com", "a.md"), []);
});

test("跨文件引用优先未保存标签，并能读取未展开文件树中的目标", async () => {
  const current = { path: "a.md", content: "# 当前\n内容" };
  const read: string[] = [];
  const context = { current, openDocuments: [{ path: "b.md", content: "# 未保存\n新内容 ^new" }], availablePaths: [], readFile: async (path: string) => { read.push(path); return { path, content: "# 磁盘\n内容" }; } };
  const result = await loadDocumentReference("b.md#^new", context);
  assert.equal(result.content.slice(result.range.from, result.range.to), "新内容");
  assert.deepEqual(read, []);
  assert.equal((await loadDocumentReference("deep/file.md#磁盘", context)).range.startLine, 1);
  assert.deepEqual(read, ["deep/file.md"]);
  await assert.rejects(loadDocumentReference("b.md#不存在", context), /引用位置不存在/);
});

test("引用在表格行内的粗体、斜体、粗斜体中保留链接目标及格式", () => {
  for (const source of ["[[a.md#L2]]", "**[[a.md#^id]]**", "*[[#章节]]*", "***[[a.md#L2-L4|选中范围]]***"]) {
    const nodes = parseTableInlineMarkdown(source);
    assert.match(JSON.stringify(nodes), /wikilinkTarget/);
    if (source.startsWith("***")) { assert.match(JSON.stringify(nodes), /"tag":"strong"/); assert.match(JSON.stringify(nodes), /"tag":"em"/); }
  }
});
