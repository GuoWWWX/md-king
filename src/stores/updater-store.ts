import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useDocumentTabsStore } from "./document-tabs-store.ts";
import { useAppStore } from "./app-store.ts";
import { useVaultStore } from "./vault-store.ts";
import { createDocumentSession, documentSessionStorageKey } from "../lib/document-session.ts";
import {
  fetchLatestRelease,
  downloadUpdateInstaller,
  launchUpdateInstaller,
  cancelUpdateDownload,
  type DownloadProgressPayload,
} from "../lib/tauri.ts";

export type GitHubReleaseAsset = {
  name: string;
  size: number;
  browser_download_url: string;
};

export type GitHubRelease = {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
  assets: GitHubReleaseAsset[];
};

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "cancelling" | "installing" | "ready_to_install" | "error";

export type DownloadProgress = {
  percent: number;
  transferred: number;
  total: number;
  speedBytesPerSec: number;
};

export interface UpdaterState {
  currentVersion: string;
  latestRelease: GitHubRelease | null;
  hasUpdate: boolean;
  status: UpdateStatus;
  errorMessage: string | null;
  downloadProgress: DownloadProgress;
  installerPath: string | null;
  dialogOpen: boolean;
  ignoredVersions: string[];

  setCurrentVersion: (version: string) => void;
  checkForUpdates: (options?: { silent?: boolean; currentVer?: string }) => Promise<boolean>;
  startDownload: () => Promise<void>;
  cancelDownload: () => Promise<void>;
  installAndRelaunch: (silent?: boolean) => Promise<void>;
  setDialogOpen: (open: boolean) => void;
  ignoreCurrentRelease: () => void;
}

/**
 * 语义化版本号对比：返回 1 (v1 > v2), -1 (v1 < v2), 0 (相等)
 */
export function compareSemver(v1: string, v2: string): number {
  const clean1 = v1.replace(/^v/i, "").trim();
  const clean2 = v2.replace(/^v/i, "").trim();
  const p1 = clean1.split(".").map((n) => parseInt(n, 10) || 0);
  const p2 = clean2.split(".").map((n) => parseInt(n, 10) || 0);
  const maxLen = Math.max(p1.length, p2.length, 3);

  for (let i = 0; i < maxLen; i++) {
    const num1 = p1[i] ?? 0;
    const num2 = p2[i] ?? 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

const DEFAULT_REPO = "GuoWWWX/md-king";

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  currentVersion: "1.1.9",
  latestRelease: null,
  hasUpdate: false,
  status: "idle",
  errorMessage: null,
  downloadProgress: {
    percent: 0,
    transferred: 0,
    total: 0,
    speedBytesPerSec: 0,
  },
  installerPath: null,
  dialogOpen: false,
  ignoredVersions: [],

  setCurrentVersion: (version: string) => {
    set({ currentVersion: version });
  },

  setDialogOpen: (open: boolean) => {
    set({ dialogOpen: open });
  },

  ignoreCurrentRelease: () => {
    const { latestRelease, ignoredVersions } = get();
    if (!latestRelease) return;
    const version = latestRelease.tag_name;
    if (!ignoredVersions.includes(version)) {
      set({
        ignoredVersions: [...ignoredVersions, version],
        dialogOpen: false,
      });
      toast.info(`已忽略 ${version} 版本更新提醒`);
    }
  },

  checkForUpdates: async (options = {}) => {
    const { silent = false, currentVer } = options;
    const effectiveCurrentVer = currentVer ?? get().currentVersion;

    if (["checking", "downloading", "cancelling", "installing", "ready_to_install"].includes(get().status)) {
      return false;
    }

    set({ status: "checking", errorMessage: null });

    try {
      const jsonStr = await fetchLatestRelease(DEFAULT_REPO);
      const release: GitHubRelease | null = JSON.parse(jsonStr);
      if (!release) {
        set({ latestRelease: null, hasUpdate: false, status: "idle" });
        if (!silent) toast.info("暂未发布可下载版本");
        return false;
      }

      const latestVer = release.tag_name;
      const isNewer = compareSemver(latestVer, effectiveCurrentVer) > 0;
      const isIgnored = get().ignoredVersions.includes(latestVer);

      if (isNewer && !isIgnored) {
        set({
          latestRelease: release,
          hasUpdate: true,
          status: "available",
          errorMessage: null,
        });

        if (!silent) {
          set({ dialogOpen: true });
        }
        return true;
      }

      set({
        latestRelease: release,
        hasUpdate: false,
        status: "idle",
        errorMessage: null,
      });

      if (!silent) {
        toast.success(`当前已是最新版本 (v${effectiveCurrentVer})`);
      }
      return false;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ status: "error", errorMessage: msg });
      if (!silent) {
        toast.error(`检查更新失败: ${msg}`);
      }
      return false;
    }
  },

  startDownload: async () => {
    const { latestRelease, status } = get();
    if (!latestRelease || ["downloading", "cancelling", "installing"].includes(status)) return;

    // 寻找 Windows 安装包 asset（优先 *-setup.exe）
    const setupAsset = latestRelease.assets.find((a) => a.name === `md-king_${latestRelease.tag_name.replace(/^v/, "")}_x64-setup.exe`);

    if (!setupAsset) {
      const err = "未在该版本的 Release 中找到 Windows 安装包 (.exe)";
      set({ status: "error", errorMessage: err });
      toast.error(err);
      return;
    }

    set({
      status: "downloading",
      errorMessage: null,
      installerPath: null,
      downloadProgress: {
        percent: 0,
        transferred: 0,
        total: setupAsset.size,
        speedBytesPerSec: 0,
      },
    });

    let unlisten: (() => void) | undefined;

    try {
      unlisten = await listen<DownloadProgressPayload>("update-download-progress", (event) => {
        const payload = event.payload;
        set({
          downloadProgress: {
            percent: Math.min(100, Math.max(0, payload.percent)),
            transferred: payload.transferred,
            total: payload.total || setupAsset.size,
            speedBytesPerSec: payload.speed_bytes_per_sec,
          },
        });
      });

      if (get().status === "cancelling") {
        set({ status: "available" });
        return;
      }
      const installerPath = await downloadUpdateInstaller(setupAsset.browser_download_url, latestRelease.tag_name);

      if (get().status === "cancelling") {
        set({ status: "available" });
        return;
      }

      set({
        status: "ready_to_install",
        installerPath,
        downloadProgress: {
          percent: 100,
          transferred: setupAsset.size,
          total: setupAsset.size,
          speedBytesPerSec: 0,
        },
      });

      await get().installAndRelaunch(true);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (get().status === "cancelling" || msg.includes("下载已被用户取消")) {
        set({ status: "available", errorMessage: null });
        return;
      }
      set({ status: "error", errorMessage: msg });
      toast.error(`下载更新失败: ${msg}`);
    } finally {
      unlisten?.();
    }
  },

  cancelDownload: async () => {
    if (get().status !== "downloading") return;
    set({ status: "cancelling" });
    try {
      await cancelUpdateDownload();
      toast.info("正在取消更新下载");
    } catch (error) {
      set({ status: "downloading" });
      toast.error(`取消下载失败: ${String(error)}`);
    }
  },

  installAndRelaunch: async (silent = true) => {
    if (get().status === "installing") return;
    const { installerPath } = get();
    if (!installerPath) {
      toast.error("未找到已下载的安装程序");
      return;
    }

    try {
      // Persist the latest edits synchronously before the native process exits.
      // A full/disabled storage must block installation rather than lose drafts.
      const { tabs, activeTabId } = useDocumentTabsStore.getState();
      const { activePage, pageTabs } = useAppStore.getState();
      const { vaultRoot } = useVaultStore.getState();
      const session = createDocumentSession(tabs, activeTabId, vaultRoot, activePage, pageTabs);
      window.localStorage.setItem(documentSessionStorageKey(vaultRoot), JSON.stringify(session));
      set({ status: "installing", errorMessage: null });
      toast.info("正在启动安装程序升级，软件将自动关闭...");
      await launchUpdateInstaller(installerPath, silent);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ status: "ready_to_install", errorMessage: msg });
      toast.error(`启动安装程序失败: ${msg}`);
    }
  },
}));
