import assert from "node:assert/strict";
import test from "node:test";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import {
  applyTableOperation,
  clearTableSelection,
  parseMarkdownTable,
  parseMarkdownTableRow,
  parseTableTsv,
  pasteTableTsv,
  serializeMarkdownTable,
  tableSelectionBounds,
  tableSelectionToTsv,
  tableOperationFocus,
  type MarkdownTable,
} from "./markdown-table.ts";

test("解析转义管道、代码 span、空单元格和可选首尾管道", () => {
  assert.deepEqual(parseMarkdownTableRow(" | a\\|b | `x\\|y` |  |"), ["a|b", "`x|y`", ""]);
  assert.deepEqual(parseMarkdownTableRow("a | b|"), ["a", "b"]);
  assert.deepEqual(parseMarkdownTableRow("|a||c|"), ["a", "", "c"]);
  assert.deepEqual(parseMarkdownTableRow("| `未闭合 | 仍是下一列 |"), ["`未闭合", "仍是下一列"]);
});

test("管道前连续反斜杠按奇偶决定转义或分列", () => {
  assert.deepEqual(parseMarkdownTableRow("| a\\|b |"), ["a|b"]);
  assert.deepEqual(parseMarkdownTableRow("| a\\\\|b |"), ["a\\\\", "b"]);
  assert.deepEqual(parseMarkdownTableRow("| a\\\\\\|b |"), ["a\\\\|b"]);
  assert.deepEqual(parseMarkdownTableRow("| a\\\\\\\\|b |"), ["a\\\\\\\\", "b"]);
});

test("解析对齐并按最大列数补齐", () => {
  assert.deepEqual(parseMarkdownTable("A | B\r\n:--- | ---:\r\n1 | 2 | 3"), {
    rows: [["A", "B", ""], ["1", "2", "3"]],
    alignments: ["left", "right", "none"],
  });
});

test("序列化转义编辑值并规范化换行，且结果稳定 round-trip", () => {
  const table: MarkdownTable = {
    rows: [["A|B", "Code"], ["line 1\r\nline 2", "`a|b`"]],
    alignments: ["center", "none"],
  };
  const source = serializeMarkdownTable(table);
  assert.equal(source, "| A\\|B | Code |\n| :---: | --- |\n| line 1 line 2 | `a\\|b` |");
  const parsed = parseMarkdownTable(source);
  assert.ok(parsed);
  assert.equal(serializeMarkdownTable(parsed), source);
});

test("代码 span 内转义管道整表 round-trip 后 GFM 列数稳定", () => {
  const source = "| A | B |\n| --- | --- |\n| `x\\|y` | z |";
  const table = parseMarkdownTable(source);
  assert.ok(table);
  const serialized = serializeMarkdownTable(table);
  assert.equal(serialized, source);

  const state = EditorState.create({
    doc: serialized,
    extensions: [markdown({ base: markdownLanguage, extensions: GFM })],
  });
  const tableCellCounts: number[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "TableHeader" && node.name !== "TableRow") return undefined;
      let count = 0;
      for (let child = node.node.firstChild; child; child = child.nextSibling) {
        if (child.name === "TableCell") count++;
      }
      tableCellCounts.push(count);
      return false;
    },
  });
  assert.deepEqual(tableCellCounts, [2, 2]);
});

test("列插入、删除和移动同时作用于表头、数据及对齐", () => {
  const table: MarkdownTable = { rows: [["A", "B"], ["1", "2"]], alignments: ["left", "right"] };
  const inserted = applyTableOperation(table, { type: "insert-column", index: 0, side: "right" });
  assert.deepEqual(inserted, { rows: [["A", "", "B"], ["1", "", "2"]], alignments: ["left", "none", "right"] });
  const moved = applyTableOperation(inserted, { type: "move-column", index: 2, direction: "left" });
  assert.deepEqual(moved, { rows: [["A", "B", ""], ["1", "2", ""]], alignments: ["left", "right", "none"] });
  assert.deepEqual(applyTableOperation(moved, { type: "delete-column", index: 2 }), table);
  const oneColumn: MarkdownTable = { rows: [["A"], ["1"]], alignments: ["none"] };
  assert.deepEqual(applyTableOperation(oneColumn, { type: "delete-column", index: 0 }), oneColumn);
});

test("行操作允许表头晋升并始终保留至少一行", () => {
  const table: MarkdownTable = { rows: [["H"], ["1"]], alignments: ["none"] };
  assert.deepEqual(applyTableOperation(table, { type: "insert-row", index: 0, side: "above" }).rows, [[""], ["H"], ["1"]]);
  assert.deepEqual(applyTableOperation(table, { type: "insert-row", index: 1, side: "below" }).rows, [["H"], ["1"], [""]]);
  assert.deepEqual(applyTableOperation(table, { type: "delete-row", index: 0 }).rows, [["1"]]);
  assert.deepEqual(applyTableOperation(table, { type: "delete-row", index: 1 }).rows, [["H"]]);
  assert.deepEqual(
    tableOperationFocus(table, { type: "delete-row", index: 1 }, { row: 1, column: 0 }),
    { row: 0, column: 0 },
  );
  const threeRows: MarkdownTable = { rows: [["H"], ["1"], ["2"]], alignments: ["none"] };
  assert.deepEqual(
    tableOperationFocus(threeRows, { type: "delete-row", index: 1 }, { row: 1, column: 0 }),
    { row: 1, column: 0 },
  );
  assert.deepEqual(
    tableOperationFocus(threeRows, { type: "delete-row", index: 2 }, { row: 2, column: 0 }),
    { row: 1, column: 0 },
  );
});

test("单格、整行、整列和矩形选区按 TSV 复制并可清空", () => {
  const table: MarkdownTable = {
    rows: [["H1", "H2", "H3"], ["A", "B", "C"], ["D", "E", "F"]],
    alignments: ["none", "none", "none"],
  };
  const range = { kind: "range", anchor: { row: 2, column: 2 }, focus: { row: 1, column: 1 } } as const;
  assert.deepEqual(tableSelectionBounds(table, range), { top: 1, bottom: 2, left: 1, right: 2 });
  assert.equal(tableSelectionToTsv(table, range), "B\tC\r\nE\tF");
  assert.equal(tableSelectionToTsv(table, { kind: "row", index: 1 }), "A\tB\tC");
  assert.equal(tableSelectionToTsv(table, { kind: "column", index: 0 }), "H1\r\nA\r\nD");
  assert.deepEqual(clearTableSelection(table, range).rows, [["H1", "H2", "H3"], ["A", "", ""], ["D", "", ""]]);
});

test("粘贴 TSV 从当前单元格展开并自动扩行扩列", () => {
  const table: MarkdownTable = { rows: [["H"], ["A"]], alignments: ["none"] };
  assert.deepEqual(parseTableTsv("1\t2\r\n3\t4\r\n"), [["1", "2"], ["3", "4"]]);
  const result = pasteTableTsv(table, { row: 1, column: 0 }, "1\t2\r\n3\t4");
  assert.deepEqual(result.table, {
    rows: [["H", ""], ["1", "2"], ["3", "4"]],
    alignments: ["none", "none"],
  });
  assert.deepEqual(result.selection, {
    kind: "range",
    anchor: { row: 1, column: 0 },
    focus: { row: 2, column: 1 },
  });
});
