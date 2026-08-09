import { FileText, FileType2, X, Copy } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ContextMenu } from "radix-ui";
import { useDocumentTabsStore, type DocumentTab } from "@/stores/document-tabs-store";
import { cn } from "@/lib/utils";

type DocumentTabBarProps = {
  onNewDocument: () => void;
  onImportFile?: () => void | Promise<void>;
  onBatchImport?: () => void | Promise<void>;
  onPasteClipboard: () => void | Promise<void>;
  /// 关闭一个有内容的临时标签前问一次。不传就直接关。
  onConfirmCloseScratch?: (tab: DocumentTab) => Promise<boolean>;
  /// 右侧额外按钮，比如「展开预览」。
  trailing?: ReactNode;
  className?: string;
};

export function DocumentTabBar({ onConfirmCloseScratch, trailing, className }: DocumentTabBarProps) {
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
  const suppressTabClickRef = useRef(false);
  const [draggedTabId, setDraggedTabId] = useState<string>();

  // 切到被滚动条挡住的标签时把它带回视野，否则用键盘或程序化激活后
  // 用户看不到当前在哪个文档上。
  useEffect(() => {
    if (!activeTabId) return;
    const node = listRef.current?.querySelector(`[data-tab-id="${activeTabId}"]`);
    node?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId]);

  async function requestClose(tab: DocumentTab) {
    // vault 标签的内容在磁盘上，关了还能从文件树打开；临时标签关了就真没了。
    if (tab.kind === "scratch" && tab.dirty && onConfirmCloseScratch) {
      const confirmed = await onConfirmCloseScratch(tab);
      if (!confirmed) return;
    }
    closeTab(tab.id);
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
    const tab = target.closest<HTMLElement>("[data-tab-id]");
    // 关闭按钮只处理关闭，不启动标签拖动；标签和空白区都由同一套 Pointer 逻辑处理。
    if (target.closest("button")) return;
    // 顶部标签位于桌面窗口标题栏，Tauri 在少数拖动场景会吞掉 pointerup 后的 click。
    // 按下即激活与 VS Code 的标签行为一致，也确保随后开始拖拽时目标文档已经切换。
    if (tab?.dataset.tabId) setActiveTab(tab.dataset.tabId);
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
    if (listRef.current?.hasPointerCapture(event.pointerId)) listRef.current.releasePointerCapture(event.pointerId);
  }

  function suppressClickAfterTabDrag(event: ReactMouseEvent<HTMLDivElement>) {
    if (!suppressTabClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressTabClickRef.current = false;
  }

  return (
    <div className={cn("mk-document-tab-bar flex h-9 shrink-0 items-center gap-1 rounded-[10px] border border-slate-200 bg-white px-1 dark:border-zinc-700/60 dark:bg-zinc-800/78", className)}>
      <div
        ref={listRef}
        className="scrollbar-none flex min-w-0 flex-1 select-none cursor-grab items-center gap-1 overflow-x-auto overflow-y-hidden active:cursor-grabbing"
        role="tablist"
        aria-label="打开的文档"
        onPointerDown={handleTabListPointerDown}
        onPointerMove={handleTabListPointerMove}
        onPointerUp={finishTabListPointerDrag}
        onPointerCancel={finishTabListPointerDrag}
        onClickCapture={suppressClickAfterTabDrag}
      >
        {tabs.length === 0 ? (
          <span className="truncate px-2 text-xs text-slate-400 dark:text-zinc-500">从左侧文件树打开文档，或新建一个</span>
        ) : (
          tabs.map((tab) => (
            <DocumentTabItem
              key={tab.id}
              tab={tab}
              active={tab.id === activeTabId}
              dragged={tab.id === draggedTabId}
              tabCount={tabs.length}
              onSelect={() => setActiveTab(tab.id)}
              onRequestClose={() => void requestClose(tab)}
              onAuxClick={(event) => handleAuxClick(event, tab)}
              onCloseOthers={() => closeOtherTabs(tab.id)}
              onCloseAll={closeAllTabs}
            />
          ))
        )}
      </div>

      {trailing}

    </div>
  );
}

type DocumentTabItemProps = {
  tab: DocumentTab;
  active: boolean;
  tabCount: number;
  onSelect: () => void;
  onRequestClose: () => void;
  onAuxClick: (event: ReactMouseEvent) => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
  dragged: boolean;
};

const contextItemClass = "relative flex cursor-default select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-normal outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

function DocumentTabItem({ tab, active, tabCount, onSelect, onRequestClose, onAuxClick, onCloseOthers, onCloseAll, dragged }: DocumentTabItemProps) {
  const [hoveringClose, setHoveringClose] = useState(false);
  const Icon = tab.kind === "scratch" ? FileType2 : FileText;
  // 脏标记平时是个圆点，鼠标移到它上面才变成关闭叉——VS Code 的做法，
  // 既能一眼看出未保存，又不必为关闭按钮单独留位置。
  const showDot = tab.dirty && !hoveringClose;

  return (
    // 用 ContextMenu 而不是「受控 DropdownMenu + 隐藏 trigger」：后者会给
    // trigger 挂上 pointer 事件，把同级关闭按钮的点击一并吞掉。
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          data-tab-id={tab.id}
          role="tab"
          aria-selected={active}
          tabIndex={0}
          data-mk-context-menu
          title={tab.path ?? tab.title}
          className={cn(
            "mk-document-tab group flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-[8px] border px-2 text-xs font-bold transition",
            active
              ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-zinc-600/80 dark:bg-zinc-700/76 dark:text-zinc-50"
              : "border-transparent text-slate-600 hover:bg-slate-100 dark:border-zinc-700/45 dark:bg-zinc-800/72 dark:text-zinc-300 dark:hover:bg-zinc-700/80",
            // 临时文档没有落盘，用虚线边框提示它随时可能丢。
            tab.kind === "scratch" && "border-dashed",
            tab.kind === "scratch" && !active && "border-slate-300 dark:border-zinc-600",
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
              !tab.dirty && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            )}
            aria-label={`关闭 ${tab.title}`}
            onMouseEnter={() => setHoveringClose(true)}
            onMouseLeave={() => setHoveringClose(false)}
            onFocus={() => setHoveringClose(true)}
            onBlur={() => setHoveringClose(false)}
            onClick={(event) => {
              event.stopPropagation();
              onRequestClose();
            }}
          >
            {showDot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : <X className="size-3" />}
          </button>
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 w-fit rounded-[10px] border border-slate-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <ContextMenu.Item className={contextItemClass} onSelect={onRequestClose}><X className="size-4" />关闭</ContextMenu.Item>
          <ContextMenu.Item className={contextItemClass} onSelect={onCloseOthers} disabled={tabCount <= 1}><X className="size-4" />关闭其他</ContextMenu.Item>
          <ContextMenu.Item className={contextItemClass} onSelect={onCloseAll}><X className="size-4" />关闭全部</ContextMenu.Item>
          {tab.path ? (
            <>
              <ContextMenu.Separator className="-mx-1.5 my-1 h-px bg-slate-200 dark:bg-zinc-700" />
              <ContextMenu.Item className={contextItemClass} onSelect={() => void navigator.clipboard.writeText(tab.path ?? "")}><Copy className="size-4" />复制路径</ContextMenu.Item>
            </>
          ) : null}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
