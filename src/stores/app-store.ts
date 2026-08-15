import { create } from "zustand";
import type { AppConfig, AppStatus, HistoryItem, PandocStatus, Template } from "@/types";

type AppState = {
  activePage: string;
  pageTabs: string[];
  appStatus?: AppStatus;
  appConfig?: AppConfig;
  pandocStatus?: PandocStatus;
  templates: Template[];
  history: HistoryItem[];
  currentTemplateId?: string;
  pendingImportPaths: string[];
  setActivePage: (page: string) => void;
  closePageTab: (page: string) => void;
  closeOtherPageTabs: (page?: string) => void;
  closeAllPageTabs: () => void;
  setAppStatus: (status: AppStatus) => void;
  setAppConfig: (config: AppConfig) => void;
  setPandocStatus: (status: PandocStatus) => void;
  setTemplates: (templates: Template[]) => void;
  setHistory: (history: HistoryItem[]) => void;
  clearHistory: () => void;
  setCurrentTemplateId: (templateId?: string) => void;
  queueImportPaths: (paths: string[]) => void;
  clearPendingImportPaths: () => void;
};

export const useAppStore = create<AppState>((set) => ({
  activePage: "convert",
  pageTabs: [],
  templates: [],
  history: [],
  currentTemplateId: undefined,
  pendingImportPaths: [],
  setActivePage: (activePage) => set((state) => ({
    activePage,
    pageTabs: activePage === "convert" || state.pageTabs.includes(activePage)
      ? state.pageTabs
      : [...state.pageTabs, activePage],
  })),
  closePageTab: (page) => set((state) => {
    const index = state.pageTabs.indexOf(page);
    const pageTabs = state.pageTabs.filter((item) => item !== page);
    const activePage = state.activePage === page
      ? pageTabs[index] ?? pageTabs[index - 1] ?? "convert"
      : state.activePage;
    return { activePage, pageTabs };
  }),
  closeOtherPageTabs: (page) => set((state) => {
    const pageTabs = page && state.pageTabs.includes(page) ? [page] : [];
    return { pageTabs, activePage: pageTabs[0] ?? "convert" };
  }),
  closeAllPageTabs: () => set({ activePage: "convert", pageTabs: [] }),
  setAppStatus: (appStatus) => set({ appStatus }),
  setAppConfig: (appConfig) => set({ appConfig }),
  setPandocStatus: (pandocStatus) => set({ pandocStatus }),
  setTemplates: (templates) => set({ templates }),
  setHistory: (history) => set({ history }),
  clearHistory: () => set({ history: [] }),
  setCurrentTemplateId: (currentTemplateId) => set({ currentTemplateId }),
  queueImportPaths: (paths) => set((state) => ({
    pendingImportPaths: Array.from(new Set([...state.pendingImportPaths, ...paths])),
  })),
  clearPendingImportPaths: () => set({ pendingImportPaths: [] }),
}));
