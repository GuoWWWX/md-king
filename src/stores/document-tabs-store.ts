import { create } from "zustand";

/// 一个打开中的文档。分两类：
/// - vault：对应磁盘上的真实文件，path 是 vault 内相对路径，关掉还能从文件树打开
/// - scratch：粘贴/导入/新建产生的临时内容，没有落盘，关掉就没了
export type DocumentTabKind = "vault" | "scratch";

export type DocumentTab = {
  id: string;
  kind: DocumentTabKind;
  /// vault 标签是相对路径，scratch 标签为空。
  path?: string;
  /// 图片相对路径解析要用，scratch 标签没有。
  absolutePath?: string;
  title: string;
  content: string;
  /// 内容与磁盘（或最后一次同步点）不一致。scratch 标签只要有内容就算脏。
  dirty: boolean;
  /// 外部灌入内容时递增，编辑器据此决定何时做全量替换。
  revision: number;
};

type DocumentTabsState = {
  tabs: DocumentTab[];
  activeTabId?: string;

  /// 打开 vault 文件。已经开着就直接激活，不重复开。
  openVaultTab: (file: { path: string; absolutePath: string; title: string; content: string }) => string;
  /// 新建一个临时文档。source 只用于生成标题。
  openScratchTab: (input: { title: string; content: string }) => string;
  setActiveTab: (id: string) => void;
  /// 用户编辑：只改内容和脏标记，不动 revision（动了会打断输入）。
  updateTabContent: (id: string, content: string) => void;
  /// 外部替换内容（重新载入、冲突后重载），递增 revision 让编辑器全量刷新。
  replaceTabContent: (id: string, content: string) => void;
  markTabClean: (id: string) => void;
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

  openVaultTab: ({ path, absolutePath, title, content }) => {
    const existing = get().tabs.find((tab) => tab.kind === "vault" && tab.path === path);
    if (existing) {
      // 已经开着的文件重新点一次，只激活并刷新内容（磁盘上可能变了），
      // 不再开一个重复标签。
      set((state) => ({
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) => tab.id === existing.id
          ? { ...tab, content, dirty: false, revision: tab.revision + 1 }
          : tab),
      }));
      return existing.id;
    }

    const id = nextTabId("vault");
    set((state) => ({
      tabs: [...state.tabs, { id, kind: "vault", path, absolutePath, title, content, dirty: false, revision: 0 }],
      activeTabId: id,
    }));
    return id;
  },

  openScratchTab: ({ title, content }) => {
    const id = nextTabId("scratch");
    set((state) => ({
      tabs: [...state.tabs, { id, kind: "scratch", title, content, dirty: content.trim().length > 0, revision: 0 }],
      activeTabId: id,
    }));
    return id;
  },

  setActiveTab: (activeTabId) => set({ activeTabId }),

  updateTabContent: (id, content) => set((state) => ({
    tabs: state.tabs.map((tab) => {
      if (tab.id !== id) return tab;
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

  markTabClean: (id) => set((state) => ({
    tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, dirty: false } : tab)),
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
    tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...next, kind: "vault" as const } : tab)),
  })),
}));
