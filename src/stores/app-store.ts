import { create } from "zustand";
import type { AppConfig, AppStatus, HistoryItem, PandocStatus, Template } from "@/types";

type AppState = {
  activePage: string;
  appStatus?: AppStatus;
  appConfig?: AppConfig;
  pandocStatus?: PandocStatus;
  templates: Template[];
  history: HistoryItem[];
  currentTemplateId?: string;
  setActivePage: (page: string) => void;
  setAppStatus: (status: AppStatus) => void;
  setAppConfig: (config: AppConfig) => void;
  setPandocStatus: (status: PandocStatus) => void;
  setTemplates: (templates: Template[]) => void;
  setHistory: (history: HistoryItem[]) => void;
  clearHistory: () => void;
  setCurrentTemplateId: (templateId?: string) => void;
};

export const useAppStore = create<AppState>((set) => ({
  activePage: "convert",
  templates: [],
  history: [],
  currentTemplateId: undefined,
  setActivePage: (activePage) => set({ activePage }),
  setAppStatus: (appStatus) => set({ appStatus }),
  setAppConfig: (appConfig) => set({ appConfig }),
  setPandocStatus: (pandocStatus) => set({ pandocStatus }),
  setTemplates: (templates) => set({ templates }),
  setHistory: (history) => set({ history }),
  clearHistory: () => set({ history: [] }),
  setCurrentTemplateId: (currentTemplateId) => set({ currentTemplateId }),
}));
