import { ChevronsDownUp, ChevronsUpDown, FileText, ListTree, type LucideIcon } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { TooltipButton } from "@/components/ui/tooltip";
import { DocumentOutlineTree } from "./document-outline-tree";
import { collectOutlineParentLines, markdownOutlineRevealEvent, parseMarkdownOutline } from "@/lib/document-outline";
import { cn } from "@/lib/utils";
import { useDocumentTabsStore } from "@/stores/document-tabs-store";

export type DocumentDrawerView = "outline" | "info";

const DRAWER_TAB_ORDER_KEY = "md-king-document-drawer-tab-order";
const DEFAULT_DRAWER_TAB_ORDER: DocumentDrawerView[] = ["outline", "info"];

const DRAWER_TAB_DEFS: Record<DocumentDrawerView, { icon: LucideIcon; label: string }> = {
  outline: { icon: ListTree, label: "目录" },
  info: { icon: FileText, label: "信息" },
};

function loadDrawerTabOrder(): DocumentDrawerView[] {
  try {
    const raw = window.localStorage.getItem(DRAWER_TAB_ORDER_KEY);
    if (!raw) return DEFAULT_DRAWER_TAB_ORDER;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_DRAWER_TAB_ORDER;
    const known = parsed.filter((view): view is DocumentDrawerView => DEFAULT_DRAWER_TAB_ORDER.includes(view as DocumentDrawerView));
    const missing = DEFAULT_DRAWER_TAB_ORDER.filter((view) => !known.includes(view));
    // 后续新增的切换按钮还没出现在旧记录里时，补到末尾，避免老数据把新 Tab 吞掉。
    return known.length ? [...known, ...missing] : DEFAULT_DRAWER_TAB_ORDER;
  } catch {
    // localStorage 不可用或内容损坏时退回默认顺序，不影响主流程。
    return DEFAULT_DRAWER_TAB_ORDER;
  }
}

function persistDrawerTabOrder(order: DocumentDrawerView[]) {
  try {
    window.localStorage.setItem(DRAWER_TAB_ORDER_KEY, JSON.stringify(order));
  } catch {
    // 持久化失败只影响下次启动的顺序，静默忽略。
  }
}

type DocumentSideDrawerProps = {
  open: boolean;
  view: DocumentDrawerView;
  onViewChange: (view: DocumentDrawerView) => void;
  width: number;
  className?: string;
};

export function DocumentSideDrawer({ open, view, onViewChange, width, className }: DocumentSideDrawerProps) {
  const tabs = useDocumentTabsStore((state) => state.tabs);
  const activeTabId = useDocumentTabsStore((state) => state.activeTabId);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const deferredContent = useDeferredValue(activeTab?.content ?? "");
  const outline = useMemo(() => parseMarkdownOutline(deferredContent), [deferredContent]);
  const [selectedHeadingLine, setSelectedHeadingLine] = useState<number>();
  const [tabOrder, setTabOrder] = useState<DocumentDrawerView[]>(loadDrawerTabOrder);
  const [draggedTab, setDraggedTab] = useState<DocumentDrawerView>();
  const [dropTarget, setDropTarget] = useState<{ tab: DocumentDrawerView; placement: "before" | "after" }>();
  // 折叠态按标题所在行号记录：行号在同一份文档里唯一，改标题文字也不会丢状态。
  // 放在这一层是因为顶栏的一键折叠按钮和树里的单节点箭头改的是同一份状态。
  const [collapsedLines, setCollapsedLines] = useState<ReadonlySet<number>>(() => new Set<number>());

  const parentLines = useMemo(() => collectOutlineParentLines(outline), [outline]);
  // 只要还有一个可折叠节点是展开的，按钮就应该是「全部折叠」，避免半折叠状态下按钮语义含糊。
  const allCollapsed = parentLines.length > 0 && parentLines.every((line) => collapsedLines.has(line));

  useEffect(() => {
    setSelectedHeadingLine(undefined);
    setCollapsedLines(new Set<number>());
  }, [activeTabId]);

  function toggleCollapsedLine(line: number) {
    setCollapsedLines((current) => {
      const next = new Set(current);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  }

  function toggleCollapseAll() {
    setCollapsedLines(allCollapsed ? new Set<number>() : new Set(parentLines));
  }

  function revealHeading(line: number) {
    if (!activeTab) return;
    setSelectedHeadingLine(line);
    window.dispatchEvent(new CustomEvent(markdownOutlineRevealEvent, { detail: { tabId: activeTab.id, line } }));
  }

  function moveTab(source: DocumentDrawerView, target: DocumentDrawerView, placement: "before" | "after") {
    if (source === target) return;
    setTabOrder((current) => {
      const next = current.filter((item) => item !== source);
      // 先移除 source 再定位 target，所以 target 下标已经不含 source；
      // "after" 时要在 target 后面插入一位，否则前后拖拽会互相抵消。
      const targetIndex = next.indexOf(target) + (placement === "after" ? 1 : 0);
      next.splice(targetIndex, 0, source);
      persistDrawerTabOrder(next);
      return next;
    });
  }

  if (!open) return null;

  return (
    <aside
      className={cn("mk-document-side-panel mk-card flex h-full min-h-0 shrink-0 flex-col overflow-hidden rounded-[5px] border border-slate-200 bg-white shadow-none dark:border-zinc-700 dark:bg-[#202020]", className)}
      style={{ width }}
      aria-label="文档侧栏"
    >
      <header className="flex h-9 shrink-0 items-center gap-0.5 border-b border-slate-200 px-1.5 dark:border-zinc-800" role="tablist" aria-label="文档侧栏选项">
        {tabOrder.map((tabView) => {
          const def = DRAWER_TAB_DEFS[tabView];
          return (
            <DrawerIconButton
              key={tabView}
              active={view === tabView}
              icon={def.icon}
              label={def.label}
              dropPlacement={dropTarget?.tab === tabView ? dropTarget.placement : undefined}
              onClick={() => onViewChange(tabView)}
              onDragStart={() => setDraggedTab(tabView)}
              onDragEnd={() => {
                setDraggedTab(undefined);
                setDropTarget(undefined);
              }}
              onDragOver={(event) => {
                if (!draggedTab || draggedTab === tabView) return;
                // 按鼠标落在图标左半还是右半判定插入到前面还是后面，
                // 用 dragover（而不是只在 dragenter 里判一次）才能跟手实时更新。
                const rect = event.currentTarget.getBoundingClientRect();
                const placement = event.clientX - rect.left < rect.width / 2 ? "before" : "after";
                setDropTarget((current) => (current?.tab === tabView && current.placement === placement ? current : { tab: tabView, placement }));
              }}
              onDragLeave={() => setDropTarget((current) => (current?.tab === tabView ? undefined : current))}
              onDrop={() => {
                if (draggedTab && dropTarget) moveTab(draggedTab, dropTarget.tab, dropTarget.placement);
                setDraggedTab(undefined);
                setDropTarget(undefined);
              }}
            />
          );
        })}

        {/* 一键折叠/展开只对目录视图有意义，信息视图下整行按钮都不渲染。
            没有任何可折叠节点（全是同级标题）时也隐藏，避免点了没反应。 */}
        {view === "outline" && parentLines.length > 0 ? (
          <TooltipButton
            type="button"
            tooltip={allCollapsed ? "全部展开" : "全部折叠"}
            tooltipSide="bottom"
            aria-label={allCollapsed ? "全部展开" : "全部折叠"}
            onClick={toggleCollapseAll}
            className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-[6px] text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            {allCollapsed ? <ChevronsUpDown className="size-4" /> : <ChevronsDownUp className="size-4" />}
          </TooltipButton>
        ) : null}
      </header>

      {view === "outline" ? (
        // 目录自己管滚动和内边距：搜索框要吸在顶部，不能跟着列表一起滚。
        <div className="min-h-0 flex-1 overflow-hidden">
          {!activeTab ? (
            <EmptyState>打开 Markdown 文档后显示标题目录。</EmptyState>
          ) : outline.length === 0 ? (
            <EmptyState>当前文档没有 Markdown 标题。</EmptyState>
          ) : (
            <DocumentOutlineTree
              outline={outline}
              selectedLine={selectedHeadingLine}
              onSelect={revealHeading}
              collapsedLines={collapsedLines}
              onToggleCollapsed={toggleCollapsedLine}
            />
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {activeTab ? (
            <dl className="divide-y divide-slate-100 text-sm dark:divide-zinc-800">
              <InfoRow label="文件名称" value={activeTab.title} />
              <InfoRow label="文件类型" value={activeTab.kind === "vault" ? "本地 Markdown 文档" : "临时 Markdown 文档"} />
              <InfoRow label="文件路径" value={activeTab.path ?? "尚未保存到磁盘"} />
              <InfoRow label="编辑状态" value={activeTab.dirty ? "未保存修改" : "已保存"} />
              <InfoRow label="正文长度" value={`${activeTab.content.length.toLocaleString()} 个字符`} />
            </dl>
          ) : (
            <EmptyState>尚未打开 Markdown 文档。</EmptyState>
          )}
        </div>
      )}
    </aside>
  );
}

function DrawerIconButton({
  active,
  icon: Icon,
  label,
  dropPlacement,
  onClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  dropPlacement: "before" | "after" | undefined;
  onClick: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLButtonElement>) => void;
  onDragLeave: () => void;
  onDrop: () => void;
}) {
  return (
    <TooltipButton
      type="button"
      role="tab"
      aria-selected={active}
      tooltip={label}
      tooltipSide="bottom"
      draggable
      className={cn(
        "relative flex size-7 shrink-0 items-center justify-center rounded-[6px] transition",
        active
          ? "bg-slate-200 text-slate-950 dark:bg-zinc-700 dark:text-zinc-50"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
      )}
      onClick={onClick}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver(event);
      }}
      onDragLeave={onDragLeave}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      {dropPlacement === "before" ? <span aria-hidden className="pointer-events-none absolute inset-y-1 -left-px z-10 w-0.5 rounded-full bg-blue-500 dark:bg-blue-400" /> : null}
      {dropPlacement === "after" ? <span aria-hidden className="pointer-events-none absolute inset-y-1 -right-px z-10 w-0.5 rounded-full bg-blue-500 dark:bg-blue-400" /> : null}
      <Icon className="size-4" />
    </TooltipButton>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-2 py-10 text-center text-xs leading-5 text-slate-500 dark:text-zinc-400">{children}</p>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 py-2.5">
      <dt className="text-xs text-slate-500 dark:text-zinc-400">{label}</dt>
      <dd className="break-words text-xs leading-5 text-slate-800 dark:text-zinc-100">{value}</dd>
    </div>
  );
}
