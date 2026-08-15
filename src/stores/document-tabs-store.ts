import { create } from "zustand";
import type { VaultEol } from "@/types/vault";

/// 一个打开中的文档。分两类：
/// - vault：对应磁盘上的真实文件，path 是 vault 内相对路径，关掉还能从文件树打开
/// - scratch：粘贴/导入/新建产生的临时内容，没有落盘，关掉就没了
export type DocumentTabKind = "vault" | "scratch" | "image";

export type DocumentTab = {
  id: string;
  kind: DocumentTabKind;
  /// vault 标签是相对路径，scratch 标签为空。
  path?: string;
  /// 图片相对路径解析要用，scratch 标签没有。
  absolutePath?: string;
  title: string;
  content: string;
  /// 内容与磁盘（或最后一次同步点）不一致。
  dirty: boolean;
  /// Vault 文件的写回基准。每个标签单独保存，切换标签后仍能正确自动保存。
  eol?: VaultEol;
  hasBom?: boolean;
  modifiedMs?: number;
  /// 外部灌入内容时递增，编辑器据此决定何时做全量替换。
  revision: number;
};

type DocumentTabsState = {
  tabs: DocumentTab[];
  activeTabId?: string;

  /// 打开 vault 文件。已经开着就直接激活，不重复开。
  openVaultTab: (file: { path: string; absolutePath: string; title: string; content: string; eol?: VaultEol; hasBom?: boolean; modifiedMs?: number }) => string;
  /// 新建一个临时文档。source 只用于生成标题。
  openScratchTab: (input: { title: string; content: string; dirty?: boolean }) => string;
  /// 图片和 Markdown 一样作为工作区标签打开，但不会进入编辑、保存或转换流程。
  openImageTab: (file: { path: string; absolutePath: string; title: string }) => string;
  setActiveTab: (id: string) => void;
  /// 拖动标签排序；beforeId 为空表示移到末尾。
  moveTab: (id: string, beforeId?: string) => void;
  /// 用户编辑：只改内容和脏标记，不动 revision（动了会打断输入）。
  updateTabContent: (id: string, content: string) => void;
  /// 外部替换内容（重新载入、冲突后重载），递增 revision 让编辑器全量刷新。
  replaceTabContent: (id: string, content: string) => void;
  markTabClean: (id: string, modifiedMs?: number) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;
  renameTab: (id: string, next: { path: string; absolutePath: string; title: string }) => void;
};

let tabSeq = 0;
function nextTabId(prefix: string) {
  tabSeq += 1;
  return `${prefix}-${tabSeq}`;
}

/// 从正文里猜一个标题：优先第一个 ATX 标题，否则取第一行非空文本。
export function deriveScratchTitle(content: string, fallback = "未命名") {
  const lines = content.split("\n");
  const heading = lines.find((line) => /^#{1,6}\s+\S/.test(line));
  if (heading) return heading.replace(/^#{1,6}\s+/, "").trim().slice(0, 40) || fallback;
  const firstText = lines.find((line) => line.trim().length > 0);
  return firstText ? firstText.trim().slice(0, 40) : fallback;
}

/// 关闭标签后该激活谁：优先右边那个，没有就左边——和浏览器、VS Code 一致。
function neighborTabId(tabs: DocumentTab[], closingId: string) {
  const index = tabs.findIndex((tab) => tab.id === closingId);
  if (index < 0) return undefined;
  return tabs[index + 1]?.id ?? tabs[index - 1]?.id;
}

export const useDocumentTabsStore = create<DocumentTabsState>((set, get) => ({
  tabs: [],
  activeTabId: undefined,

  openVaultTab: (file) => {
    const existing = get().tabs.find((tab) => tab.kind === "vault" && tab.path === file.path);
    if (existing) {
      // 有本地修改时不能拿刚读回来的磁盘内容覆盖它；只激活标签，
      // 否则“重新点文件树”会绕过关闭确认直接丢掉改动。
      if (existing.dirty) {
        set({ activeTabId: existing.id });
        return existing.id;
      }
      // 已经开着且干净的文件可刷新内容与写回基准，不再开一个重复标签。
      set((state) => ({
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) => tab.id === existing.id
          ? { ...tab, ...file, dirty: false, revision: tab.revision + 1 }
          : tab),
      }));
      return existing.id;
    }

    const id = nextTabId("vault");
    set((state) => ({
      tabs: [...state.tabs, { id, kind: "vault", ...file, dirty: false, revision: 0 }],
      activeTabId: id,
    }));
    return id;
  },

  openScratchTab: ({ title, content, dirty = false }) => {
    const id = nextTabId("scratch");
    set((state) => ({
      tabs: [...state.tabs, { id, kind: "scratch", title, content, dirty, revision: 0 }],
      activeTabId: id,
    }));
    return id;
  },

  openImageTab: (file) => {
    const existing = get().tabs.find((tab) => tab.kind === "image" && tab.path === file.path);
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }

    const id = nextTabId("image");
    set((state) => ({
      tabs: [...state.tabs, { id, kind: "image", ...file, content: "", dirty: false, revision: 0 }],
      activeTabId: id,
    }));
    return id;
  },

  setActiveTab: (activeTabId) => set({ activeTabId }),

  moveTab: (id, beforeId) => set((state) => {
    const fromIndex = state.tabs.findIndex((tab) => tab.id === id);
    if (fromIndex < 0 || id === beforeId) return state;

    const nextTabs = [...state.tabs];
    const [movedTab] = nextTabs.splice(fromIndex, 1);
    const targetIndex = beforeId ? nextTabs.findIndex((tab) => tab.id === beforeId) : nextTabs.length;
    nextTabs.splice(targetIndex < 0 ? nextTabs.length : targetIndex, 0, movedTab);
    return { tabs: nextTabs };
  }),

  updateTabContent: (id, content) => set((state) => ({
    tabs: state.tabs.map((tab) => {
      if (tab.id !== id) return tab;
      // CodeMirror 初次挂载也会回传当前文本；内容没变时不能把刚打开的文件标成未保存。
      if (tab.content === content) return tab;
      // scratch 标签的标题跟着正文首个标题走，边写边更新，
      // 这样标签上就不会长期挂着一个「未命名」。
      const title = tab.kind === "scratch" ? deriveScratchTitle(content, tab.title) : tab.title;
      return { ...tab, content, title, dirty: true };
    }),
  })),

  replaceTabContent: (id, content) => set((state) => ({
    tabs: state.tabs.map((tab) => tab.id === id
      ? { ...tab, content, dirty: false, revision: tab.revision + 1 }
      : tab),
  })),

  markTabClean: (id, modifiedMs) => set((state) => ({
    tabs: state.tabs.map((tab) => (tab.id === id
      ? { ...tab, dirty: false, modifiedMs: modifiedMs ?? tab.modifiedMs }
      : tab)),
  })),

  closeTab: (id) => set((state) => {
    const nextActive = state.activeTabId === id ? neighborTabId(state.tabs, id) : state.activeTabId;
    return { tabs: state.tabs.filter((tab) => tab.id !== id), activeTabId: nextActive };
  }),

  closeOtherTabs: (id) => set((state) => ({
    tabs: state.tabs.filter((tab) => tab.id === id),
    activeTabId: id,
  })),

  closeAllTabs: () => set({ tabs: [], activeTabId: undefined }),

  renameTab: (id, next) => set((state) => ({
    tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...next } : tab)),
  })),
}));
