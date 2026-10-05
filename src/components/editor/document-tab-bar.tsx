import { ChevronDown, ChevronRight, ClipboardPaste, Files, FileText, FileType2, FileUp, ImageIcon, Plus, X, Copy, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ContextMenu } from "radix-ui";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { collectOverflowedTabKeys, tabWheelScrollDelta } from "@/lib/document-tab-overflow";
import { isTauriEnvironment, handleTauriWindowDrag } from "@/lib/tauri";
import { useDocumentTabsStore, type DocumentTab } from "@/stores/document-tabs-store";
import { cn } from "@/lib/utils";

export type DocumentPageTab = {
  id: string;
  label: string;
  icon: LucideIcon;
};

type DocumentTabBarProps = {
  onNewDocument: () => void;
  onImportFile?: () => void | Promise<void>;
  onBatchImport?: () => void | Promise<void>;
  onPasteClipboard: () => void | Promise<void>;
  /// 关闭有未保存改动的标签前由页面决定保存、放弃或取消。
  onBeforeClose?: (tab: DocumentTab) => Promise<boolean>;
  /// 只有手动保存模式才展示脏状态圆点。
  showDirtyIndicator?: boolean;
  /// 应用页面与 Markdown 文档共用同一条标签栏。
  pageTabs?: DocumentPageTab[];
  activePage?: string;
  onSelectDocument?: () => void;
  onSelectPage?: (page: string) => void;
  onClosePage?: (page: string) => void;
  onCloseOtherPageTabs?: (keptPageId?: string) => void;
  onCloseAllPageTabs?: () => void;
  /// 右侧额外按钮，比如「展开预览」。
  trailing?: ReactNode;
  className?: string;
};

export function DocumentTabBar({ onImportFile, onBatchImport, onPasteClipboard, onBeforeClose, showDirtyIndicator = true, pageTabs = [], activePage = "convert", onSelectDocument, onSelectPage, onClosePage, onCloseOtherPageTabs, onCloseAllPageTabs, trailing, className }: DocumentTabBarProps) {
  const tabs = useDocumentTabsStore((state) => state.tabs);
  const activeTabId = useDocumentTabsStore((state) => state.activeTabId);
  const setActiveTab = useDocumentTabsStore((state) => state.setActiveTab);
  const closeTab = useDocumentTabsStore((state) => state.closeTab);
  const closeOtherTabs = useDocumentTabsStore((state) => state.closeOtherTabs);
  const closeAllTabs = useDocumentTabsStore((state) => state.closeAllTabs);
  const moveTab = useDocumentTabsStore((state) => state.moveTab);
  const listRef = useRef<HTMLDivElement>(null);
  const tabDragRef = useRef<{
    tabId?: string;
    startX: number;
    startScrollLeft: number;
    moved: boolean;
    hasTarget: boolean;
    lastBeforeId?: string;
  } | null>(null);
  const windowDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressTabClickRef = useRef(false);
  const [draggedTabId, setDraggedTabId] = useState<string>();
  const [overflowedTabKeys, setOverflowedTabKeys] = useState<string[]>([]);
  const tabLayoutKey = useMemo(
    () => [
      ...tabs.map((tab) => `document:${tab.id}:${tab.title}`),
      ...pageTabs.map((tab) => `page:${tab.id}:${tab.label}`),
    ].join("\n"),
    [pageTabs, tabs],
  );
  const overflowedTabKeySet = useMemo(() => new Set(overflowedTabKeys), [overflowedTabKeys]);
  const overflowedDocumentTabs = tabs.filter((tab) => overflowedTabKeySet.has(`document:${tab.id}`));
  const overflowedPageTabs = pageTabs.filter((tab) => overflowedTabKeySet.has(`page:${tab.id}`));
  const hasOverflowedTabs = overflowedDocumentTabs.length > 0 || overflowedPageTabs.length > 0;

  // 切到被滚动条挡住的文档或工作页时把它带回视野。
  useEffect(() => {
    const selector = activePage === "convert"
      ? activeTabId ? `[data-tab-id="${activeTabId}"]` : undefined
      : `[data-page-tab-id="${activePage}"]`;
    if (!selector) return;
    const node = listRef.current?.querySelector(selector);
    node?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activePage, activeTabId]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;

    let frame = 0;
    const updateOverflowedTabs = () => {
      frame = 0;
      const viewport = list.getBoundingClientRect();
      const next = collectOverflowedTabKeys(
        { left: viewport.left, right: viewport.right },
        Array.from(list.querySelectorAll<HTMLElement>("[data-tab-overflow-key]")).map((tab) => {
          const bounds = tab.getBoundingClientRect();
          return {
            key: tab.dataset.tabOverflowKey ?? "",
            left: bounds.left,
            right: bounds.right,
          };
        }),
      ).filter(Boolean);
      setOverflowedTabKeys((current) => (
        current.length === next.length && current.every((key, index) => key === next[index])
          ? current
          : next
      ));
    };
    const scheduleUpdate = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateOverflowedTabs);
    };

    scheduleUpdate();
    list.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(scheduleUpdate);
    observer?.observe(list);
    list.querySelectorAll<HTMLElement>("[data-tab-overflow-key]").forEach((tab) => observer?.observe(tab));

    return () => {
      if (frame) cancelAnimationFrame(frame);
      list.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      observer?.disconnect();
    };
  }, [tabLayoutKey]);

  useEffect(() => {
    const handleBlur = () => {
      windowDragRef.current = null;
      tabDragRef.current = null;
      setDraggedTabId(undefined);
    };
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, []);

  async function requestClose(tab: DocumentTab) {
    if (tab.dirty && onBeforeClose) {
      const confirmed = await onBeforeClose(tab);
      if (!confirmed) return;
    }
    closeTab(tab.id);
  }

  async function requestCloseTabs(candidates: DocumentTab[], close: () => void) {
    for (const tab of candidates) {
      if (tab.dirty && onBeforeClose) {
        const confirmed = await onBeforeClose(tab);
        if (!confirmed) return;
      }
    }
    close();
  }

  async function requestCloseOtherTabs(keptId: string) {
    const candidates = useDocumentTabsStore.getState().tabs.filter((tab) => tab.id !== keptId);
    await requestCloseTabs(candidates, () => {
      closeOtherTabs(keptId);
      onCloseOtherPageTabs?.();
    });
  }

  async function requestCloseAllTabs() {
    await requestCloseTabs(useDocumentTabsStore.getState().tabs, () => {
      closeAllTabs();
      onCloseAllPageTabs?.();
    });
  }

  async function requestCloseOtherFromPageTab(keptPageId: string) {
    await requestCloseTabs(useDocumentTabsStore.getState().tabs, () => {
      closeAllTabs();
      onCloseOtherPageTabs?.(keptPageId);
    });
  }

  function handleAuxClick(event: ReactMouseEvent, tab: DocumentTab) {
    // 中键关闭：浏览器和编辑器的通用习惯，实现成本几乎为零。
    if (event.button !== 1) return;
    event.preventDefault();
    void requestClose(tab);
  }

  function handleTabListPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !listRef.current) return;
    const target = event.target as HTMLElement;
    // Radix Portal 的 DOM 已经离开标签列表，但 React 事件仍会冒泡回来。
    // 菜单项绝不能触发标签拖动或抢走 pointer capture。
    if (target.closest("[data-mk-tab-context-menu-content]")) return;
    const tab = target.closest<HTMLElement>("[data-tab-id]");
    const pageTab = target.closest<HTMLElement>("[data-page-tab-id]");
    if (!tab && !pageTab) {
      if (!isTauriEnvironment()) return;
      void getCurrentWindow().startDragging().catch(() => undefined);
      return;
    }
    // 顶部标签位于无边框桌面窗口的标题栏内。少数 Tauri 拖动场景会吞掉
    // pointerup 后的 click，因此页面标签与文档标签都在按下时完成切换。
    // 关闭按钮仍只关闭，不能因为按下关闭按钮把工作区切走。
    if (pageTab?.dataset.pageTabId) {
      if (!target.closest("button")) onSelectPage?.(pageTab.dataset.pageTabId);
      return;
    }
    // 关闭按钮只处理关闭，不启动标签拖动。
    if (target.closest("button")) return;
    // 按下即激活与 VS Code 的标签行为一致，也确保随后开始拖拽时目标文档已经切换。
    if (tab?.dataset.tabId) {
      setActiveTab(tab.dataset.tabId);
      onSelectDocument?.();
    }
    tabDragRef.current = {
      tabId: tab?.dataset.tabId,
      startX: event.clientX,
      startScrollLeft: listRef.current.scrollLeft,
      moved: false,
      hasTarget: false,
    };
    listRef.current.setPointerCapture(event.pointerId);
  }

  function handleTabListPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const windowDrag = windowDragRef.current;
    if (windowDrag && listRef.current) {
      const movedX = event.clientX - windowDrag.startX;
      const movedY = event.clientY - windowDrag.startY;
      if (Math.hypot(movedX, movedY) < 4) return;
      windowDragRef.current = null;
      if (listRef.current.hasPointerCapture(windowDrag.pointerId)) {
        listRef.current.releasePointerCapture(windowDrag.pointerId);
      }
      event.preventDefault();
      void getCurrentWindow().startDragging().catch(() => undefined);
      return;
    }

    const drag = tabDragRef.current;
    if (!drag || !listRef.current) return;
    const delta = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(delta) < 4) return;
    drag.moved = true;
    event.preventDefault();

    if (!drag.tabId) {
      listRef.current.scrollLeft = drag.startScrollLeft - delta;
      return;
    }

    setDraggedTabId(drag.tabId);

    // 拖到列表左右边缘时自动滚动，便于把标签移到当前可视区域之外。
    const listRect = listRef.current.getBoundingClientRect();
    const edgeDistance = 28;
    if (event.clientX < listRect.left + edgeDistance) {
      listRef.current.scrollLeft -= 12;
    } else if (event.clientX > listRect.right - edgeDistance) {
      listRef.current.scrollLeft += 12;
    }

    const tabNodes = Array.from(listRef.current.querySelectorAll<HTMLElement>("[data-tab-id]"))
      .filter((node) => node.dataset.tabId !== drag.tabId);
    const beforeId = tabNodes.find((node) => {
      const rect = node.getBoundingClientRect();
      return event.clientX < rect.left + rect.width / 2;
    })?.dataset.tabId;

    if (!drag.hasTarget || drag.lastBeforeId !== beforeId) {
      drag.hasTarget = true;
      drag.lastBeforeId = beforeId;
      moveTab(drag.tabId, beforeId);
    }
  }

  function finishTabListPointerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    try {
      if (listRef.current?.hasPointerCapture(event.pointerId)) {
        listRef.current.releasePointerCapture(event.pointerId);
      }
    } catch {
      // 忽略 WebView 已释放
    }

    const windowDrag = windowDragRef.current;
    if (windowDrag) {
      windowDragRef.current = null;
      try {
        if (listRef.current?.hasPointerCapture(windowDrag.pointerId)) {
          listRef.current.releasePointerCapture(windowDrag.pointerId);
        }
      } catch {
        // 忽略
      }
    }

    const drag = tabDragRef.current;
    if (!drag) return;
    if (drag.moved) {
      // Pointer 拖动结束后浏览器会紧接着派发 click；只拦住这一次，
      // 避免某些环境没有派发 click 时把下一次正常选标签也吞掉。
      suppressTabClickRef.current = true;
      window.setTimeout(() => {
        suppressTabClickRef.current = false;
      }, 0);
    }
    tabDragRef.current = null;
    setDraggedTabId(undefined);
  }

  function suppressClickAfterTabDrag(event: ReactMouseEvent<HTMLDivElement>) {
    if (!suppressTabClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressTabClickRef.current = false;
  }

  function handleTabListDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("[data-tab-id], [data-page-tab-id], button")) return;
    if (!isTauriEnvironment()) return;
    event.preventDefault();
    void getCurrentWindow().toggleMaximize().catch(() => undefined);
  }

  function handleTabListWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const list = event.currentTarget;
    if (event.ctrlKey || list.scrollWidth <= list.clientWidth + 1) return;
    const delta = tabWheelScrollDelta(
      event.deltaX,
      event.deltaY,
      event.deltaMode,
      list.clientWidth,
    );
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    list.scrollLeft += delta;
  }

  function selectOverflowedDocumentTab(tabId: string) {
    setActiveTab(tabId);
    onSelectDocument?.();
    revealOverflowedTab(`document:${tabId}`);
  }

  function revealOverflowedTab(tabKey: string) {
    requestAnimationFrame(() => {
      const tab = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-tab-overflow-key]") ?? [])
        .find((node) => node.dataset.tabOverflowKey === tabKey);
      tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  return (
    <div
      className={cn("mk-document-tab-bar flex h-8 shrink-0 items-center gap-1 rounded-[10px] border border-slate-200 bg-white px-1 dark:border-zinc-700/60 dark:bg-[#202020]", className)}
      data-tauri-drag-region
      onPointerDown={handleTauriWindowDrag}
    >
      <div
        ref={listRef}
        className="scrollbar-none flex min-w-0 flex-1 cursor-default select-none items-center gap-1 overflow-x-auto overflow-y-hidden"
        role="tablist"
        aria-label="打开的标签"
        onPointerDown={handleTabListPointerDown}
        onPointerMove={handleTabListPointerMove}
        onPointerUp={finishTabListPointerDrag}
        onPointerCancel={finishTabListPointerDrag}
        onClickCapture={suppressClickAfterTabDrag}
        onDoubleClick={handleTabListDoubleClick}
        onWheel={handleTabListWheel}
      >
        {tabs.length === 0 && pageTabs.length === 0 ? (
          <span className="truncate px-2 text-xs text-slate-400 dark:text-zinc-500">从左侧文件树打开文档，或通过 + 导入</span>
        ) : (
          <>
            {tabs.map((tab) => (
            <DocumentTabItem
              key={tab.id}
              tab={tab}
              active={activePage === "convert" && tab.id === activeTabId}
              dragged={tab.id === draggedTabId}
              showDirtyIndicator={showDirtyIndicator}
              tabCount={tabs.length + pageTabs.length}
              onSelect={() => {
                setActiveTab(tab.id);
                onSelectDocument?.();
              }}
              onRequestClose={() => requestClose(tab)}
              onAuxClick={(event) => handleAuxClick(event, tab)}
              onCloseOthers={() => requestCloseOtherTabs(tab.id)}
              onCloseAll={requestCloseAllTabs}
            />
            ))}
            {pageTabs.map((tab) => (
              <PageTabItem
                key={tab.id}
                tab={tab}
                active={tab.id === activePage}
                tabCount={tabs.length + pageTabs.length}
                onSelect={() => onSelectPage?.(tab.id)}
                onClose={() => onClosePage?.(tab.id)}
                onCloseOthers={() => requestCloseOtherFromPageTab(tab.id)}
                onCloseAll={requestCloseAllTabs}
              />
            ))}
          </>
        )}
        <span className="min-w-0 flex-1 self-stretch" aria-hidden />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={!hasOverflowedTabs}
            className="h-9 w-7 shrink-0 rounded-none border-0 bg-transparent shadow-none text-slate-500 hover:bg-transparent hover:text-slate-950 active:bg-transparent aria-expanded:bg-transparent data-[state=open]:bg-transparent focus-visible:border-transparent focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-transparent dark:hover:text-zinc-100"
            title={hasOverflowedTabs ? "查看隐藏的标签" : "没有隐藏的标签"}
            tooltipSide="bottom"
            aria-label="查看隐藏的标签"
          >
            <ChevronDown className="size-4" strokeWidth={2.25} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 min-w-60 max-w-80 overflow-y-auto p-1.5">
          {overflowedDocumentTabs.map((tab) => {
            const Icon = tab.kind === "scratch" ? FileType2 : tab.kind === "image" ? ImageIcon : FileText;
            return (
              <DropdownMenuItem
                key={`document:${tab.id}`}
                title={tab.path ?? tab.title}
                onSelect={() => selectOverflowedDocumentTab(tab.id)}
              >
                <Icon className="size-4 shrink-0 text-slate-500 dark:text-zinc-400" />
                <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                {tab.dirty ? <span className="size-1.5 shrink-0 rounded-full bg-current" aria-label="未保存" /> : null}
              </DropdownMenuItem>
            );
          })}
          {overflowedPageTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <DropdownMenuItem
                key={`page:${tab.id}`}
                onSelect={() => {
                  onSelectPage?.(tab.id);
                  revealOverflowedTab(`page:${tab.id}`);
                }}
              >
                <Icon className="size-4 shrink-0 text-slate-500 dark:text-zinc-400" />
                <span className="min-w-0 flex-1 truncate">{tab.label}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-8 shrink-0 rounded-none border-0 bg-transparent shadow-none text-slate-500 hover:bg-transparent hover:text-slate-950 active:bg-transparent aria-expanded:bg-transparent data-[state=open]:bg-transparent focus-visible:border-transparent focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-zinc-400 dark:hover:bg-transparent dark:hover:text-zinc-100"
            title="导入文档"
            tooltipSide="bottom"
            aria-label="导入文档"
          >
            <Plus className="size-4" strokeWidth={2.5} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-36 p-1.5">
          {onImportFile ? (
            <DropdownMenuItem onSelect={() => void Promise.resolve(onImportFile())}>
              <FileUp className="size-4 text-[var(--app-primary)]" />
              选择文件
            </DropdownMenuItem>
          ) : null}
          {onBatchImport ? (
            <DropdownMenuItem onSelect={() => void Promise.resolve(onBatchImport())}>
              <Files className="size-4 text-[var(--app-primary)]" />
              批量导入
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => void Promise.resolve(onPasteClipboard())}>
            <ClipboardPaste className="size-4 text-[var(--app-primary)]" />
            粘贴剪贴板
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {trailing}

    </div>
  );
}

function PageTabItem({ tab, active, tabCount, onSelect, onClose, onCloseOthers, onCloseAll }: {
  tab: DocumentPageTab;
  active: boolean;
  tabCount: number;
  onSelect: () => void;
  onClose: () => void;
  onCloseOthers: () => Promise<void>;
  onCloseAll: () => Promise<void>;
}) {
  const Icon = tab.icon;
  const runningContextActionRef = useRef<Promise<void> | undefined>(undefined);

  function runContextAction(action: () => Promise<void>) {
    if (runningContextActionRef.current) return;
    const operation = action();
    runningContextActionRef.current = operation;
    void operation.finally(() => {
      if (runningContextActionRef.current === operation) runningContextActionRef.current = undefined;
    });
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          data-page-tab-id={tab.id}
          data-tab-overflow-key={`page:${tab.id}`}
          data-mk-context-menu
          role="tab"
          aria-selected={active}
          tabIndex={0}
          title={tab.label}
          className={cn(
            "mk-document-tab group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[8px] border px-2 text-xs font-bold transition",
            active
              ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-zinc-600/80 dark:bg-zinc-700/76 dark:text-zinc-50"
              : "border-slate-200/80 text-slate-600 hover:bg-slate-100 dark:border-zinc-700/60 dark:text-zinc-400 dark:hover:bg-zinc-800/72 dark:hover:text-zinc-200",
          )}
          onClick={onSelect}
          onAuxClick={(event) => {
            if (event.button !== 1) return;
            event.preventDefault();
            onClose();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect();
            }
          }}
        >
          <Icon className="size-3.5 shrink-0 opacity-70" />
          <span className="max-w-[160px] truncate">{tab.label}</span>
          <button
            type="button"
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-[4px] opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100",
              active ? "hover:bg-blue-200/70 dark:hover:bg-blue-500/30" : "hover:bg-slate-200 dark:hover:bg-zinc-700",
            )}
            aria-label={`关闭 ${tab.label}`}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <X className="size-3" />
          </button>
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content data-mk-tab-context-menu-content className="z-50 w-fit rounded-[10px] border border-slate-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <ContextMenu.Item className={contextItemClass} onSelect={() => runContextAction(async () => onClose())} onClick={() => runContextAction(async () => onClose())}><X className="size-4" />关闭</ContextMenu.Item>
          <ContextMenu.Item className={contextItemClass} onSelect={() => runContextAction(onCloseOthers)} onClick={() => runContextAction(onCloseOthers)} disabled={tabCount <= 1}><X className="size-4" />关闭其他</ContextMenu.Item>
          <ContextMenu.Item className={contextItemClass} onSelect={() => runContextAction(onCloseAll)} onClick={() => runContextAction(onCloseAll)}><X className="size-4" />关闭全部</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

type DocumentTabItemProps = {
  tab: DocumentTab;
  active: boolean;
  tabCount: number;
  showDirtyIndicator: boolean;
  onSelect: () => void;
  onRequestClose: () => Promise<void>;
  onAuxClick: (event: ReactMouseEvent) => void;
  onCloseOthers: () => Promise<void>;
  onCloseAll: () => Promise<void>;
  dragged: boolean;
};

const contextItemClass = "relative flex cursor-default select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-normal outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

function isAbsoluteFilePath(path: string) {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(path);
}

function DocumentTabItem({ tab, active, tabCount, showDirtyIndicator, onSelect, onRequestClose, onAuxClick, onCloseOthers, onCloseAll, dragged }: DocumentTabItemProps) {
  const [hoveringClose, setHoveringClose] = useState(false);
  const runningContextActionRef = useRef<Promise<void> | undefined>(undefined);
  const Icon = tab.kind === "scratch" ? FileType2 : tab.kind === "image" ? ImageIcon : FileText;
  const relativePath = tab.path && !isAbsoluteFilePath(tab.path) ? tab.path : undefined;
  const absolutePath = tab.absolutePath ?? (tab.path && isAbsoluteFilePath(tab.path) ? tab.path : undefined);
  // 脏标记平时是个圆点，鼠标移到它上面才变成关闭叉——VS Code 的做法，
  // 既能一眼看出未保存，又不必为关闭按钮单独留位置。
  // 临时文档没有可供自动保存的磁盘路径，因此即使全局启用了自动保存，
  // 仍必须显示未保存圆点，直到用户主动选择路径保存。
  const hasManualUnsavedChanges = tab.dirty && (showDirtyIndicator || tab.kind === "scratch");
  const showDot = hasManualUnsavedChanges && !hoveringClose;

  // 标题栏里的 Portal 菜单在部分桌面 WebView 中只会留下 click 或 select 其中一个
  // 事件。两个事件共用同一把锁，既能兜底，又不会把一次关闭执行两遍。
  function runContextAction(action: () => Promise<void>) {
    if (runningContextActionRef.current) return;
    const operation = action();
    runningContextActionRef.current = operation;
    void operation.finally(() => {
      if (runningContextActionRef.current === operation) runningContextActionRef.current = undefined;
    });
  }

  return (
    // 用 ContextMenu 而不是「受控 DropdownMenu + 隐藏 trigger」：后者会给
    // trigger 挂上 pointer 事件，把同级关闭按钮的点击一并吞掉。
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          data-tab-id={tab.id}
          data-tab-overflow-key={`document:${tab.id}`}
          role="tab"
          aria-selected={active}
          tabIndex={0}
          data-mk-context-menu
          title={tab.path ?? tab.title}
          className={cn(
            "mk-document-tab group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[8px] border px-2 text-xs font-bold transition",
            active
              ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-zinc-600/80 dark:bg-zinc-700/76 dark:text-zinc-50"
              : "border-slate-200/80 text-slate-600 hover:bg-slate-100 dark:border-zinc-700/60 dark:text-zinc-400 dark:hover:bg-zinc-800/72 dark:hover:text-zinc-200",
            // 临时文档没有落盘，用虚线边框提示它随时可能丢。
            tab.kind === "scratch" && "border-dashed",
            tab.kind === "scratch" && !active && "border-slate-300 dark:border-zinc-700",
            dragged && "opacity-55",
          )}
          onClick={onSelect}
          onAuxClick={onAuxClick}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect();
            }
          }}
        >
          <Icon className="size-3.5 shrink-0 opacity-70" />
          <span className="max-w-[160px] truncate">{tab.title}</span>
          <button
            type="button"
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-[4px] transition",
              active ? "hover:bg-blue-200/70 dark:hover:bg-blue-500/30" : "hover:bg-slate-200 dark:hover:bg-zinc-700",
              !hasManualUnsavedChanges && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            )}
            aria-label={`关闭 ${tab.title}`}
            onMouseEnter={() => setHoveringClose(true)}
            onMouseLeave={() => setHoveringClose(false)}
            onFocus={() => setHoveringClose(true)}
            onBlur={() => setHoveringClose(false)}
            onClick={(event) => {
              event.stopPropagation();
              void onRequestClose();
            }}
          >
            {showDot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : <X className="size-3" />}
          </button>
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content data-mk-tab-context-menu-content className="z-50 w-fit rounded-[10px] border border-slate-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <ContextMenu.Item className={contextItemClass} onSelect={() => runContextAction(onRequestClose)} onClick={() => runContextAction(onRequestClose)}><X className="size-4" />关闭</ContextMenu.Item>
          <ContextMenu.Item className={contextItemClass} onSelect={() => runContextAction(onCloseOthers)} onClick={() => runContextAction(onCloseOthers)} disabled={tabCount <= 1}><X className="size-4" />关闭其他</ContextMenu.Item>
          <ContextMenu.Item className={contextItemClass} onSelect={() => runContextAction(onCloseAll)} onClick={() => runContextAction(onCloseAll)}><X className="size-4" />关闭全部</ContextMenu.Item>
          {relativePath || absolutePath ? (
            <>
              <ContextMenu.Separator className="-mx-1.5 my-1 h-px bg-slate-200 dark:bg-zinc-700" />
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger className={contextItemClass}>
                  <Copy className="size-4" />复制路径<ChevronRight className="ml-auto size-4" />
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent data-mk-tab-context-menu-content className="z-50 min-w-40 rounded-[10px] border border-slate-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                    <ContextMenu.Item className={contextItemClass} onSelect={() => void navigator.clipboard.writeText(relativePath ?? "")} disabled={!relativePath}>复制相对路径</ContextMenu.Item>
                    <ContextMenu.Item className={contextItemClass} onSelect={() => void navigator.clipboard.writeText(absolutePath ?? "")} disabled={!absolutePath}>复制绝对路径</ContextMenu.Item>
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>
            </>
          ) : null}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
