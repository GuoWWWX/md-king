import { findObsidianWikilinks } from "../../../lib/document-links.ts";
import { findInlineMarkdownMath } from "../../../lib/markdown-math.ts";

export type TableAlignment = "none" | "left" | "center" | "right";

export interface MarkdownTable {
  /** 第一行是表头，其余是数据行。Markdown 分隔行单独保存在 alignments 中。 */
  rows: string[][];
  alignments: TableAlignment[];
  columnWeights?: number[];
}

export type TableOperation =
  | { type: "insert-column"; index: number; side: "left" | "right" }
  | { type: "delete-column"; index: number }
  | { type: "move-column"; index: number; direction: "left" | "right" }
  | { type: "insert-row"; index: number; side: "above" | "below" }
  | { type: "delete-row"; index: number };

export interface TableCellPosition {
  row: number;
  column: number;
}

export type TableSelection =
  | { kind: "cell"; anchor: TableCellPosition; focus: TableCellPosition }
  | { kind: "range"; anchor: TableCellPosition; focus: TableCellPosition }
  | { kind: "row"; index: number }
  | { kind: "column"; index: number };

export interface TableSelectionBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function backslashRunLength(value: string, start: number): number {
  let end = start;
  while (value[end] === "\\") end++;
  return end - start;
}

/** 编辑和阅读模式共用同一套单元格点击/Shift 扩选规则。 */
export function tableCellPointerSelection(
  current: TableSelection | null,
  cell: TableCellPosition,
  extend: boolean,
): Extract<TableSelection, { kind: "cell" | "range" }> {
  if (extend && current && (current.kind === "cell" || current.kind === "range")) {
    return { kind: "range", anchor: current.anchor, focus: cell };
  }
  return { kind: "cell", anchor: cell, focus: cell };
}

function protectedTablePipePositions(value: string): Set<number> {
  const positions = new Set<number>();
  // 1. Obsidian 双链中的管道符
  for (const link of findObsidianWikilinks(value)) {
    for (let index = link.from + 2; index < link.to - 2; index++) {
      if (value[index] === "|") positions.add(index);
    }
  }
  // 2. 行内数学公式中的管道符（如 $P(A|B)$）
  for (const math of findInlineMarkdownMath(value)) {
    for (let index = math.contentFrom; index < math.contentTo; index++) {
      if (value[index] === "|") positions.add(index);
    }
  }
  return positions;
}

/** 按 GFM 表格规则拆行：管道前连续反斜杠为奇数时转义，为偶数时仍是列边界。 */
export function parseMarkdownTableRow(line: string): string[] {
  const cells: string[] = [];
  const protectedPipes = protectedTablePipePositions(line);
  let cell = "";
  let sawDelimiter = false;

  for (let index = 0; index < line.length;) {
    const char = line[index];
    if (char === "\\") {
      const run = backslashRunLength(line, index);
      if (line[index + run] === "|") {
        if (protectedPipes.has(index + run)) {
          cell += `${"\\".repeat(run)}|`;
          index += run + 1;
          continue;
        }
        if (run % 2 === 1) {
          cell += `${"\\".repeat(run - 1)}|`;
          index += run + 1;
          continue;
        }
        cell += "\\".repeat(run);
        cells.push(cell.trim());
        cell = "";
        sawDelimiter = true;
        index += run + 1;
        continue;
      }
      cell += "\\".repeat(run);
      index += run;
      continue;
    }
    if (char === "|") {
      if (protectedPipes.has(index)) {
        cell += char;
        index++;
        continue;
      }
      cells.push(cell.trim());
      cell = "";
      sawDelimiter = true;
      index++;
      continue;
    }
    cell += char;
    index++;
  }
  cells.push(cell.trim());

  if (sawDelimiter && cells[0] === "") cells.shift();
  if (sawDelimiter && cells[cells.length - 1] === "") cells.pop();
  return cells.length > 0 ? cells : [""];
}

interface ParsedDelimiter {
  alignment: TableAlignment;
  weight: number;
}

function parseDelimiterColumn(cell: string): ParsedDelimiter | null {
  const value = cell.trim();
  if (!/^:?-+:?$/.test(value)) return null;
  const left = value.startsWith(":");
  const right = value.endsWith(":");
  const alignment: TableAlignment = left && right ? "center" : left ? "left" : right ? "right" : "none";
  const hyphenCount = (value.match(/-/g) ?? []).length;
  return {
    alignment,
    weight: Math.max(1, hyphenCount),
  };
}

function padRow(row: readonly string[], columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => row[index] ?? "");
}

export function parseMarkdownTable(source: string): MarkdownTable | null {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  while (lines[lines.length - 1] === "") lines.pop();
  if (lines.length < 2) return null;

  const parsedRows = lines.map(parseMarkdownTableRow);
  const parsedDelimiters = parsedRows[1].map(parseDelimiterColumn);
  if (parsedDelimiters.length === 0 || parsedDelimiters.some((delimiter) => delimiter === null)) return null;

  const contentRows = [parsedRows[0], ...parsedRows.slice(2)];
  const columnCount = Math.max(1, parsedDelimiters.length, ...contentRows.map((row) => row.length));
  return {
    rows: contentRows.map((row) => padRow(row, columnCount)),
    alignments: Array.from(
      { length: columnCount },
      (_, index) => parsedDelimiters[index]?.alignment ?? "none",
    ),
    columnWeights: Array.from(
      { length: columnCount },
      (_, index) => parsedDelimiters[index]?.weight ?? 3,
    ),
  };
}

function normalizeCell(value: string): string {
  return value.replace(/\r\n?|\n/g, " ").trim();
}

/** 普通管道写回表格时需要转义；Obsidian 双链中的别名分隔符保持原样。 */
export function serializeMarkdownTableCell(value: string): string {
  const normalized = normalizeCell(value);
  const protectedPipes = protectedTablePipePositions(normalized);
  let result = "";

  for (let index = 0; index < normalized.length;) {
    const char = normalized[index];
    if (char === "|" && !protectedPipes.has(index)) result += "\\|";
    else result += char;
    index++;
  }
  return result;
}

function separatorFor(alignment: TableAlignment, weight = 3): string {
  const dashes = "-".repeat(Math.max(1, weight));
  if (alignment === "left") return `:${dashes}`;
  if (alignment === "right") return `${dashes}:`;
  if (alignment === "center") return `:${dashes}:`;
  return dashes;
}

export function serializeMarkdownTable(table: MarkdownTable): string {
  const columnCount = Math.max(1, table.alignments.length, ...table.rows.map((row) => row.length));
  const alignments = Array.from(
    { length: columnCount },
    (_, index): TableAlignment => table.alignments[index] ?? "none",
  );
  const weights = Array.from(
    { length: columnCount },
    (_, index): number => table.columnWeights?.[index] ?? 3,
  );
  const rows = table.rows.length > 0 ? table.rows : [Array(columnCount).fill("")];
  const serializeRow = (row: readonly string[]) =>
    `| ${padRow(row, columnCount).map(serializeMarkdownTableCell).join(" | ")} |`;

  return [
    serializeRow(rows[0]),
    serializeRow(alignments.map((alignment, index) => separatorFor(alignment, weights[index]))),
    ...rows.slice(1).map(serializeRow),
  ].join("\n");
}

export function applyTableOperation(table: MarkdownTable, operation: TableOperation): MarkdownTable {
  const rows = table.rows.map((row) => [...row]);
  const alignments = [...table.alignments];
  const columnWeights = table.columnWeights ? [...table.columnWeights] : undefined;
  const columnCount = Math.max(1, alignments.length, ...rows.map((row) => row.length));
  for (const row of rows) while (row.length < columnCount) row.push("");
  while (alignments.length < columnCount) alignments.push("none");
  if (columnWeights) while (columnWeights.length < columnCount) columnWeights.push(3);

  if (operation.type === "insert-column") {
    const insertAt = Math.max(0, Math.min(columnCount, operation.index + (operation.side === "right" ? 1 : 0)));
    rows.forEach((row) => row.splice(insertAt, 0, ""));
    alignments.splice(insertAt, 0, "none");
    columnWeights?.splice(insertAt, 0, 3);
  } else if (operation.type === "delete-column") {
    if (columnCount > 1 && operation.index >= 0 && operation.index < columnCount) {
      rows.forEach((row) => row.splice(operation.index, 1));
      alignments.splice(operation.index, 1);
      columnWeights?.splice(operation.index, 1);
    }
  } else if (operation.type === "move-column") {
    const target = operation.index + (operation.direction === "left" ? -1 : 1);
    if (operation.index >= 0 && operation.index < columnCount && target >= 0 && target < columnCount) {
      rows.forEach((row) => [row[operation.index], row[target]] = [row[target], row[operation.index]]);
      [alignments[operation.index], alignments[target]] = [alignments[target], alignments[operation.index]];
      if (columnWeights) {
        [columnWeights[operation.index], columnWeights[target]] = [columnWeights[target], columnWeights[operation.index]];
      }
    }
  } else if (operation.type === "insert-row") {
    const insertAt = Math.max(0, Math.min(rows.length, operation.index + (operation.side === "below" ? 1 : 0)));
    rows.splice(insertAt, 0, Array(columnCount).fill(""));
  } else if (operation.type === "delete-row") {
    if (rows.length > 1 && operation.index >= 0 && operation.index < rows.length) rows.splice(operation.index, 1);
  }

  return { rows, alignments, ...(columnWeights ? { columnWeights } : {}) };
}

/** 将一列移动到指定的最终位置，同时保持各行和对齐方式同步。 */
export function reorderTableColumn(table: MarkdownTable, from: number, to: number): MarkdownTable {
  const rows = table.rows.map((row) => [...row]);
  const columnCount = Math.max(1, table.alignments.length, ...rows.map((row) => row.length));
  if (from < 0 || from >= columnCount || to < 0 || to >= columnCount || from === to) {
    return {
      rows,
      alignments: [...table.alignments],
      ...(table.columnWeights ? { columnWeights: [...table.columnWeights] } : {}),
    };
  }

  const alignments = Array.from(
    { length: columnCount },
    (_, index): TableAlignment => table.alignments[index] ?? "none",
  );
  const columnWeights = table.columnWeights
    ? Array.from({ length: columnCount }, (_, index): number => table.columnWeights?.[index] ?? 3)
    : undefined;

  rows.forEach((row) => {
    while (row.length < columnCount) row.push("");
    const [cell] = row.splice(from, 1);
    row.splice(to, 0, cell);
  });
  const [alignment] = alignments.splice(from, 1);
  alignments.splice(to, 0, alignment);
  if (columnWeights) {
    const [weight] = columnWeights.splice(from, 1);
    columnWeights.splice(to, 0, weight);
  }
  return { rows, alignments, ...(columnWeights ? { columnWeights } : {}) };
}

/** 将一行移动到指定的最终位置；表头也可以被拖到普通数据行位置。 */
export function reorderTableRow(table: MarkdownTable, from: number, to: number): MarkdownTable {
  const rows = table.rows.map((row) => [...row]);
  if (from < 0 || from >= rows.length || to < 0 || to >= rows.length || from === to) {
    return {
      rows,
      alignments: [...table.alignments],
      ...(table.columnWeights ? { columnWeights: [...table.columnWeights] } : {}),
    };
  }
  const [row] = rows.splice(from, 1);
  rows.splice(to, 0, row);
  return {
    rows,
    alignments: [...table.alignments],
    ...(table.columnWeights ? { columnWeights: [...table.columnWeights] } : {}),
  };
}

function tableSize(table: MarkdownTable): { rows: number; columns: number } {
  return {
    rows: Math.max(1, table.rows.length),
    columns: Math.max(1, table.alignments.length, ...table.rows.map((row) => row.length)),
  };
}

function clampPosition(table: MarkdownTable, position: TableCellPosition): TableCellPosition {
  const size = tableSize(table);
  return {
    row: Math.max(0, Math.min(position.row, size.rows - 1)),
    column: Math.max(0, Math.min(position.column, size.columns - 1)),
  };
}

export function tableSelectionBounds(table: MarkdownTable, selection: TableSelection): TableSelectionBounds {
  const size = tableSize(table);
  if (selection.kind === "row") {
    const row = Math.max(0, Math.min(selection.index, size.rows - 1));
    return { top: row, bottom: row, left: 0, right: size.columns - 1 };
  }
  if (selection.kind === "column") {
    const column = Math.max(0, Math.min(selection.index, size.columns - 1));
    return { top: 0, bottom: size.rows - 1, left: column, right: column };
  }
  const anchor = clampPosition(table, selection.anchor);
  const focus = clampPosition(table, selection.focus);
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.column, focus.column),
    right: Math.max(anchor.column, focus.column),
  };
}

/** 选区覆盖每一行、每一列时，按整张 Markdown 表格处理，而不是按 TSV 处理。 */
export function tableSelectionCoversWholeTable(table: MarkdownTable, selection: TableSelection): boolean {
  const size = tableSize(table);
  const bounds = tableSelectionBounds(table, selection);
  return bounds.top === 0
    && bounds.bottom === size.rows - 1
    && bounds.left === 0
    && bounds.right === size.columns - 1;
}

export function tableSelectionToTsv(table: MarkdownTable, selection: TableSelection): string {
  const bounds = tableSelectionBounds(table, selection);
  const lines: string[] = [];
  for (let row = bounds.top; row <= bounds.bottom; row++) {
    const cells: string[] = [];
    for (let column = bounds.left; column <= bounds.right; column++) {
      cells.push((table.rows[row]?.[column] ?? "").replace(/\r\n?|\n/g, " "));
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\r\n");
}

export function parseTableTsv(value: string): string[][] {
  const normalized = value.replace(/\r\n?/g, "\n");
  const lines = normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
  return (lines.length > 0 ? lines : [""]).map((line) => line.split("\t"));
}

export function clearTableSelection(table: MarkdownTable, selection: TableSelection): MarkdownTable {
  const next = {
    rows: table.rows.map((row) => [...row]),
    alignments: [...table.alignments],
  };
  const bounds = tableSelectionBounds(next, selection);
  for (let row = bounds.top; row <= bounds.bottom; row++) {
    for (let column = bounds.left; column <= bounds.right; column++) {
      next.rows[row][column] = "";
    }
  }
  return next;
}

export function pasteTableTsv(
  table: MarkdownTable,
  start: TableCellPosition,
  value: string,
): { table: MarkdownTable; selection: TableSelection } {
  const matrix = parseTableTsv(value);
  const origin = clampPosition(table, start);
  const neededRows = origin.row + matrix.length;
  const neededColumns = origin.column + Math.max(1, ...matrix.map((row) => row.length));
  const columnCount = Math.max(neededColumns, tableSize(table).columns);
  const rows = table.rows.map((row) => padRow(row, columnCount));
  while (rows.length < neededRows) rows.push(Array(columnCount).fill(""));
  const alignments = Array.from(
    { length: columnCount },
    (_, index): TableAlignment => table.alignments[index] ?? "none",
  );

  matrix.forEach((row, rowOffset) => {
    row.forEach((cell, columnOffset) => {
      rows[origin.row + rowOffset][origin.column + columnOffset] = normalizeCell(cell);
    });
  });

  const focus = {
    row: origin.row + matrix.length - 1,
    column: origin.column + Math.max(1, ...matrix.map((row) => row.length)) - 1,
  };
  return {
    table: { rows, alignments },
    selection: {
      kind: matrix.length === 1 && focus.column === origin.column ? "cell" : "range",
      anchor: origin,
      focus,
    },
  };
}

/** 结构操作重建 Widget 后，将焦点约束到仍存在的单元格。 */
export function tableOperationFocus(
  table: MarkdownTable,
  operation: TableOperation,
  requested: TableCellPosition,
): TableCellPosition {
  const next = applyTableOperation(table, operation);
  return {
    row: Math.max(0, Math.min(requested.row, next.rows.length - 1)),
    column: Math.max(0, Math.min(requested.column, next.alignments.length - 1)),
  };
}
