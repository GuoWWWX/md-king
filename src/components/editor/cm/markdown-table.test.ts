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
  reorderTableColumn,
  reorderTableRow,
  serializeMarkdownTable,
  tableSelectionBounds,
  tableCellPointerSelection,
  tableSelectionCoversWholeTable,
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

test("Obsidian 双链别名中的管道不会拆成额外列", () => {
  const source = [
    "| 领域 | 入口 | 规范 | 定位 |",
    "| ---- | ---- | ---- | ---- |",
    "| 🤖 **AI 应用开发** | [[../10-AI应用开发/00-总览/学习仪表盘|AI 仪表盘]] | [[../10-AI应用开发/README|AI 规范]] | 转型主攻方向 |",
  ].join("\n");
  const table = parseMarkdownTable(source);

  assert.ok(table);
  assert.deepEqual(table.rows, [
    ["领域", "入口", "规范", "定位"],
    [
      "🤖 **AI 应用开发**",
      "[[../10-AI应用开发/00-总览/学习仪表盘|AI 仪表盘]]",
      "[[../10-AI应用开发/README|AI 规范]]",
      "转型主攻方向",
    ],
  ]);
  assert.equal(serializeMarkdownTable(table), source);
});

test("数学公式中的管道不会拆成额外列且写回不破坏", () => {
  const source = [
    "| 公式 | 数值 | 说明 |",
    "| --- | --- | --- |",
    "| $P(A|B)$ | 0.85 | 条件概率 |",
  ].join("\n");
  const table = parseMarkdownTable(source);

  assert.ok(table);
  assert.deepEqual(table.rows, [
    ["公式", "数值", "说明"],
    ["$P(A|B)$", "0.85", "条件概率"],
  ]);
  assert.equal(serializeMarkdownTable(table), source);
});

test("解析对齐并按最大列数补齐", () => {
  assert.deepEqual(parseMarkdownTable("A | B\r\n:--- | ---:\r\n1 | 2 | 3"), {
    rows: [["A", "B", ""], ["1", "2", "3"]],
    alignments: ["left", "right", "none"],
    columnWeights: [3, 3, 3],
  });
});

test("支持 :-:、:--:、:-、-: 等任意长度连字符分隔符并提取列宽权重", () => {
  const source = [
    "| 序号 | 状态 | 描述 | 操作 | 默认 |",
    "| :-: | :--: | :------- | ---: | -- |",
    "| 1 | 正常 | 详情描述文本 | 删除 | 内容 |",
  ].join("\n");
  const table = parseMarkdownTable(source);
  assert.ok(table);
  assert.deepEqual(table.alignments, ["center", "center", "left", "right", "none"]);
  assert.deepEqual(table.columnWeights, [1, 2, 7, 3, 2]);
  assert.equal(serializeMarkdownTable(table), source);
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

test("拖拽重排列会完整移动单元格和对齐方式", () => {
  const table: MarkdownTable = {
    rows: [["A", "B", "C"], ["1", "2", "3"]],
    alignments: ["left", "center", "right"],
  };
  assert.deepEqual(reorderTableColumn(table, 0, 2), {
    rows: [["B", "C", "A"], ["2", "3", "1"]],
    alignments: ["center", "right", "left"],
  });
  assert.deepEqual(reorderTableColumn(table, 1, 1), table);
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

test("拖拽重排行允许表头和数据行互换", () => {
  const table: MarkdownTable = {
    rows: [["H"], ["A"], ["B"]],
    alignments: ["none"],
  };
  assert.deepEqual(reorderTableRow(table, 0, 2).rows, [["A"], ["B"], ["H"]]);
  assert.deepEqual(reorderTableRow(table, 2, 0).rows, [["B"], ["H"], ["A"]]);
  assert.deepEqual(reorderTableRow(table, 1, 1), table);
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

test("阅读模式和编辑模式使用相同的单元格点击与 Shift 扩选规则", () => {
  const first = tableCellPointerSelection(null, { row: 1, column: 1 }, false);
  assert.deepEqual(first, {
    kind: "cell",
    anchor: { row: 1, column: 1 },
    focus: { row: 1, column: 1 },
  });
  assert.deepEqual(tableCellPointerSelection(first, { row: 3, column: 2 }, true), {
    kind: "range",
    anchor: { row: 1, column: 1 },
    focus: { row: 3, column: 2 },
  });
  assert.deepEqual(tableCellPointerSelection({ kind: "row", index: 1 }, { row: 2, column: 0 }, true), {
    kind: "cell",
    anchor: { row: 2, column: 0 },
    focus: { row: 2, column: 0 },
  });
});

test("拖选覆盖所有单元格时识别为整张表格", () => {
  const table: MarkdownTable = {
    rows: [["H1", "H2"], ["A", "B"], ["C", "D"]],
    alignments: ["none", "none"],
  };
  assert.equal(tableSelectionCoversWholeTable(table, {
    kind: "range",
    anchor: { row: 0, column: 0 },
    focus: { row: 2, column: 1 },
  }), true);
  assert.equal(tableSelectionCoversWholeTable(table, { kind: "row", index: 1 }), false);
  assert.equal(tableSelectionCoversWholeTable(table, { kind: "column", index: 0 }), false);
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
