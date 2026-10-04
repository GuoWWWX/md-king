import { ChevronRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildMarkdownOutlineTree, type MarkdownOutlineItem, type MarkdownOutlineNode } from "@/lib/document-outline";
import { cn } from "@/lib/utils";

type DocumentOutlineTreeProps = {
  outline: MarkdownOutlineItem[];
  selectedLine?: number;
  onSelect: (line: number) => void;
  /// 折叠态提到外层：顶栏的一键展开/折叠按钮和这里的单节点箭头改的是同一份状态。
  collapsedLines: ReadonlySet<number>;
  onToggleCollapsed: (line: number) => void;
};

/// 只保留自身命中或子孙命中的节点；命中项的子树同样按关键字过滤，
/// 避免匹配到一个大标题就把整章内容全部倒出来。
function filterOutlineTree(nodes: MarkdownOutlineNode[], query: string): MarkdownOutlineNode[] {
  const result: MarkdownOutlineNode[] = [];
  for (const node of nodes) {
    const children = filterOutlineTree(node.children, query);
    if (node.text.toLowerCase().includes(query) || children.length) result.push({ ...node, children });
  }
  return result;
}

export function DocumentOutlineTree({ outline, selectedLine, onSelect, collapsedLines, onToggleCollapsed }: DocumentOutlineTreeProps) {
  const [query, setQuery] = useState("");

  const tree = useMemo(() => buildMarkdownOutlineTree(outline), [outline]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTree = useMemo(
    () => (normalizedQuery ? filterOutlineTree(tree, normalizedQuery) : tree),
    [tree, normalizedQuery],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-2 pt-2">
        {/* 定位上下文收在输入框这一层：外层带 padding 时 top-1/2 会算上 padding，
            再拿 translate 去补就会和 -translate-y-1/2 冲突（Tailwind 只保留后者）。
            外观复用文件树搜索框的 .mk-file-tree-search，边框/底色/焦点环保持一致。 */}
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题"
            aria-label="搜索文档标题"
            className="mk-file-tree-search h-7 w-full rounded-[6px] pr-6 pl-7 text-[13px] outline-none"
          />
          {query ? (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-[4px] p-0.5 text-slate-400 transition hover:text-slate-700 dark:text-zinc-500 dark:hover:text-zinc-100"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>
      </div>

      <nav aria-label="Markdown 文档目录" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {visibleTree.length === 0 ? (
          <p className="px-2 py-8 text-center text-[11px] leading-5 text-slate-500 dark:text-zinc-400">没有匹配的标题。</p>
        ) : (
          <OutlineNodeList
            nodes={visibleTree}
            depth={0}
            selectedLine={selectedLine}
            // 搜索时强制展开，否则命中项藏在折叠的父节点里等于搜不到。
            collapsedLines={normalizedQuery ? undefined : collapsedLines}
            onToggle={onToggleCollapsed}
            onSelect={onSelect}
          />
        )}
      </nav>
    </div>
  );
}

function OutlineNodeList({
  nodes,
  depth,
  selectedLine,
  collapsedLines,
  onToggle,
  onSelect,
}: {
  nodes: MarkdownOutlineNode[];
  depth: number;
  selectedLine?: number;
  collapsedLines: ReadonlySet<number> | undefined;
  onToggle: (line: number) => void;
  onSelect: (line: number) => void;
}) {
  return (
    <div className={cn(depth > 0 && "ml-2.5 border-l border-slate-200 pl-1 dark:border-zinc-700/80")}>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const collapsed = hasChildren && (collapsedLines?.has(node.line) ?? false);
        const selected = selectedLine === node.line;

        return (
          <div key={`${node.line}-${node.text}`}>
            <OutlineNodeItem
              node={node}
              selected={selected}
              hasChildren={hasChildren}
              collapsed={collapsed}
              onToggle={onToggle}
              onSelect={onSelect}
            />

            {hasChildren && !collapsed ? (
              <OutlineNodeList
                nodes={node.children}
                depth={depth + 1}
                selectedLine={selectedLine}
                collapsedLines={collapsedLines}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function OutlineNodeItem({
  node,
  selected,
  hasChildren,
  collapsed,
  onToggle,
  onSelect,
}: {
  node: MarkdownOutlineNode;
  selected: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  onToggle: (line: number) => void;
  onSelect: (line: number) => void;
}) {
  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) {
      itemRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selected]);

  return (
    <div
      ref={itemRef}
      className={cn(
        "group relative flex h-6 items-center gap-0.5 rounded-[5px] pr-1 transition",
        selected
          ? "bg-blue-50 text-blue-700 font-semibold dark:bg-blue-500/15 dark:text-blue-200 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[2.5px] before:rounded-full before:bg-blue-600 dark:before:bg-blue-400"
          : "hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-300",
      )}
    >
      {hasChildren ? (
        <button
          type="button"
          aria-label={collapsed ? `展开 ${node.text}` : `折叠 ${node.text}`}
          aria-expanded={!collapsed}
          onClick={() => onToggle(node.line)}
          className="flex size-4 shrink-0 items-center justify-center rounded-[3px] text-slate-400 transition hover:text-slate-700 dark:text-zinc-500 dark:hover:text-zinc-200"
        >
          <ChevronRight className={cn("size-3 transition-transform", !collapsed && "rotate-90")} />
        </button>
      ) : (
        <span aria-hidden className="size-4 shrink-0" />
      )}
      <button
        type="button"
        onClick={() => onSelect(node.line)}
        style={{ fontSize: "12px", fontFamily: "sans-serif", fontWeight: selected ? 600 : 500 }}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1 truncate text-left leading-6 transition",
          selected
            ? "text-blue-700 dark:text-blue-200"
            : "text-slate-600 group-hover:text-slate-950 dark:text-zinc-300 dark:group-hover:text-zinc-50",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{node.text}</span>
        <span
          className={cn(
            "ml-1 shrink-0 text-[10px] font-semibold transition",
            selected ? "text-blue-500 dark:text-blue-400" : "text-slate-400 dark:text-zinc-500",
          )}
        >
          H{node.level}
        </span>
      </button>
    </div>
  );
}
