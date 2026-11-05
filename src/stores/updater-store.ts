import { t } from "../lib/i18n.ts";
import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useDocumentTabsStore } from "./document-tabs-store.ts";
import { useAppStore } from "./app-store.ts";
import { useVaultStore } from "./vault-store.ts";
import { createDocumentSession, documentSessionStorageKey } from "../lib/document-session.ts";
import {
  fetchLatestRelease,
  getUpdateDownloadPlan,
  downloadUpdateInstaller,
  launchUpdateInstaller,
  cancelUpdateDownload,
  type DownloadProgressPayload,
  type UpdateDownloadPlan,
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
  isDelta?: boolean;
  applyingDelta?: boolean;
};

export interface UpdaterState {
  currentVersion: string;
  latestRelease: GitHubRelease | null;
  hasUpdate: boolean;
  status: UpdateStatus;
  checking: boolean;
  downloadVersion: string | null;
  errorMessage: string | null;
  downloadProgress: DownloadProgress;
  downloadPlan: (UpdateDownloadPlan & { version: string }) | null;
  downloadPlanChecking: boolean;
  downloadPlanFailed: boolean;
  installerPath: string | null;
  dialogOpen: boolean;
  ignoredVersions: string[];

  setCurrentVersion: (version: string) => void;
  checkForUpdates: (options?: { silent?: boolean; currentVer?: string }) => Promise<boolean>;
  prepareDownloadPlan: () => Promise<void>;
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
let versionCheck: Promise<boolean> | null = null;
let activeDownload: Promise<void> | null = null;
let downloadPlanRequest = 0;
let activePlan: { version: string; promise: Promise<void> } | null = null;

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  currentVersion: "1.2.6",
  latestRelease: null,
  hasUpdate: false,
  status: "idle",
  checking: false,
  downloadVersion: null,
  errorMessage: null,
  downloadProgress: {
    percent: 0,
    transferred: 0,
    total: 0,
    speedBytesPerSec: 0,
  },
  downloadPlan: null,
  downloadPlanChecking: false,
  downloadPlanFailed: false,
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
      toast.info(t("已忽略 {0} 版本更新提醒", [version]));
    }
  },

  checkForUpdates: async (options = {}) => {
    const { silent = false, currentVer } = options;
    const effectiveCurrentVer = currentVer ?? get().currentVersion;

    const { status, checking } = get();
    if (checking || status === "checking" || status === "cancelling" || status === "installing"
      || (silent && ["downloading", "ready_to_install"].includes(status))) {
      return false;
    }

    set({ checking: true, ...(status === "downloading" || status === "ready_to_install" ? {} : { status: "checking" }) });

    const task = (async () => {
      try {
        const jsonStr = await fetchLatestRelease(DEFAULT_REPO);
        const release: GitHubRelease | null = JSON.parse(jsonStr);
        if (!release) {
          if (get().status === "checking") set({ status: get().hasUpdate ? "available" : "idle" });
          if (!silent) toast.info(t("暂未发布可下载版本"));
          return false;
        }

        const latestVer = release.tag_name;
        const isNewer = compareSemver(latestVer, effectiveCurrentVer) > 0;
        const isIgnored = get().ignoredVersions.includes(latestVer);

        if (isNewer && !isIgnored) {
          set({
            latestRelease: release,
            hasUpdate: true,
            ...(get().status === "checking" ? { status: "available" } : {}),
            ...(get().status === "ready_to_install" && get().downloadVersion !== latestVer
              ? { status: "available", installerPath: null } : {}),
            errorMessage: null,
          });

          if (!silent) {
            set({ dialogOpen: true });
            toast.success(t("最新可下载版本：{0}", [latestVer]));
          }
          if (get().status === "available") void get().prepareDownloadPlan();
          return true;
        }

        set({
          hasUpdate: false,
          ...(get().status === "checking" ? { latestRelease: release, status: "idle" } : {}),
          errorMessage: null,
        });

        if (!silent) {
          toast.success(t("当前已是最新版本 (v{0})", [effectiveCurrentVer]));
        }
        return false;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (get().status === "checking") set({ status: "error", errorMessage: msg });
        if (!silent) {
          toast.error(t("检查更新失败: {0}", [msg]));
        }
        return false;
      } finally {
        set({ checking: false });
      }
    })();
    versionCheck = task;
    try {
      return await task;
    } finally {
      if (versionCheck === task) versionCheck = null;
    }
  },

  prepareDownloadPlan: async () => {
    const release = get().latestRelease;
    if (!release) return;
    if (activePlan?.version === release.tag_name) return activePlan.promise;
    const asset = release.assets.find((item) => item.name === `md-king_${release.tag_name.replace(/^v/, "")}_x64-setup.exe`);
    const request = ++downloadPlanRequest;
    set({ downloadPlan: null, downloadPlanChecking: true, downloadPlanFailed: false });
    const task = (async () => {
      try {
        if (!asset) throw new Error("missing installer");
        const plan = await getUpdateDownloadPlan(asset.browser_download_url, release.tag_name);
        if (request === downloadPlanRequest && get().latestRelease?.tag_name === release.tag_name) {
          const { downloadVersion, status } = get();
          const superseded = downloadVersion && compareSemver(release.tag_name, downloadVersion) > 0
            && !["downloading", "cancelling", "installing"].includes(status);
          set({
            downloadPlan: { ...plan, version: release.tag_name }, downloadPlanChecking: false,
            ...(superseded ? { downloadVersion: null, downloadProgress: { percent: 0, transferred: 0, total: 0, speedBytesPerSec: 0 } } : {}),
          });
        }
      } catch {
        if (request === downloadPlanRequest && get().latestRelease?.tag_name === release.tag_name) {
          set({ downloadPlanChecking: false, downloadPlanFailed: true });
        }
      }
    })();
    activePlan = { version: release.tag_name, promise: task };
    try { await task; } finally {
      if (activePlan?.promise === task) activePlan = null;
    }
  },

  startDownload: async () => {
    const { latestRelease, status, checking, downloadVersion } = get();
    if (!latestRelease || checking || ["checking", "cancelling", "installing"].includes(status)) return;
    if (status === "downloading") {
      if (!downloadVersion || compareSemver(latestRelease.tag_name, downloadVersion) <= 0) return;
      const previousDownload = activeDownload;
      await get().cancelDownload();
      if (get().status === "downloading") return;
      await previousDownload;
      return get().startDownload();
    }

    // 寻找 Windows 安装包 asset（优先 *-setup.exe）
    const setupAsset = latestRelease.assets.find((a) => a.name === `md-king_${latestRelease.tag_name.replace(/^v/, "")}_x64-setup.exe`);

    if (!setupAsset) {
      const err = t("未在该版本的 Release 中找到 Windows 安装包 (.exe)");
      set({ status: "error", errorMessage: err });
      toast.error(err);
      return;
    }

    const plan = get().downloadPlan?.version === latestRelease.tag_name ? get().downloadPlan : null;
    set({
      status: "downloading",
      errorMessage: null,
      installerPath: null,
      downloadVersion: latestRelease.tag_name,
      downloadProgress: downloadVersion === latestRelease.tag_name ? { ...get().downloadProgress, speedBytesPerSec: 0, applyingDelta: false } : {
        percent: 0,
        transferred: 0,
        total: plan?.size ?? 0,
        speedBytesPerSec: 0,
        isDelta: plan?.isDelta ?? false,
      },
    });

    const task = (async () => {
      let unlisten: (() => void) | undefined;

      try {
        unlisten = await listen<DownloadProgressPayload>("update-download-progress", (event) => {
          const payload = event.payload;
          if (payload.version !== latestRelease.tag_name) return;
          if (get().downloadProgress.isDelta && payload.is_delta === false) {
            toast.info(t("增量包不可用，已切换为完整安装包下载"));
          }
          set({
            downloadProgress: {
              percent: Math.min(100, Math.max(0, payload.percent)),
              transferred: payload.transferred,
              total: payload.total,
              speedBytesPerSec: payload.speed_bytes_per_sec,
              isDelta: payload.is_delta ?? false,
              applyingDelta: payload.applying_delta ?? false,
            },
          });
        });

        if (get().status === "cancelling") {
          set({ status: "available" });
          return;
        }
        const installerPath = await downloadUpdateInstaller(setupAsset.browser_download_url, latestRelease.tag_name);
        // A concurrent version check must finish before deciding which package to install.
        await versionCheck;

        if (get().status === "cancelling") {
          set({ status: "available" });
          return;
        }
        if (compareSemver(get().latestRelease?.tag_name ?? latestRelease.tag_name, latestRelease.tag_name) > 0) {
          set({ status: "available", installerPath: null });
          return;
        }

        const downloadedTotal = get().downloadProgress.total;
        set({
          status: "ready_to_install",
          installerPath,
          downloadProgress: {
            ...get().downloadProgress,
            percent: 100,
            transferred: downloadedTotal,
            total: downloadedTotal,
            speedBytesPerSec: 0,
            applyingDelta: false,
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
        toast.error(t("下载更新失败: {0}", [msg]));
      } finally {
        unlisten?.();
      }
    })();
    activeDownload = task;
    try {
      await task;
    } finally {
      if (activeDownload === task) activeDownload = null;
    }
  },

  cancelDownload: async () => {
    if (get().status !== "downloading") return;
    set({ status: "cancelling" });
    try {
      await cancelUpdateDownload();
      toast.info(t("正在暂停更新下载"));
    } catch (error) {
      set({ status: "downloading" });
      toast.error(t("暂停下载失败: {0}", [String(error)]));
    }
  },

  installAndRelaunch: async (silent = true) => {
    if (get().status === "installing") return;
    const { installerPath, checking, downloadVersion, latestRelease } = get();
    if (checking || downloadVersion !== latestRelease?.tag_name) return;
    if (!installerPath) {
      toast.error(t("未找到已下载的安装程序"));
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
      toast.info(t("正在启动安装程序升级，软件将自动关闭..."));
      await launchUpdateInstaller(installerPath, silent);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ status: "ready_to_install", errorMessage: msg });
      toast.error(t("启动安装程序失败: {0}", [msg]));
    }
  },
}));
