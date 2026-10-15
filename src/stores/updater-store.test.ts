import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { compareSemver, useUpdaterStore } from "./updater-store.ts";
import { useDocumentTabsStore } from "./document-tabs-store.ts";
import type { DownloadProgressPayload } from "../lib/tauri.ts";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let commands: string[];
let storage: Map<string, string>;
let invokeCommand: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
let progressListener: (event: { payload: DownloadProgressPayload }) => void;
let failStorage = false;

beforeEach(() => {
  commands = [];
  storage = new Map();
  failStorage = false;
  invokeCommand = async (command) => command === "download_update_installer" ? "C:/temp/verified-setup.exe" : 1;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    __TAURI_INTERNALS__: {
      transformCallback: (callback: typeof progressListener) => { progressListener = callback; return 1; },
      invoke: async (command: string, args?: Record<string, unknown>) => {
        commands.push(command);
        return invokeCommand(command, args);
      },
    },
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
    localStorage: { setItem: (key: string, value: string) => {
      if (failStorage) throw new Error("草稿存储空间不足");
      commands.push("save-drafts");
      storage.set(key, value);
    } },
  } });
  useDocumentTabsStore.setState({ tabs: [], activeTabId: undefined });
  useUpdaterStore.setState({
    currentVersion: "1.1.9", status: "available", installerPath: null, errorMessage: null, hasUpdate: true,
    checking: false, downloadVersion: null, ignoredVersions: [],
    downloadProgress: { percent: 0, transferred: 0, total: 0, speedBytesPerSec: 0 },
    latestRelease: {
      tag_name: "v1.1.10", name: "Release", body: "", published_at: "", html_url: "",
      assets: [{ name: "md-king_1.1.10_x64-setup.exe", size: 3, browser_download_url: "https://github.com/GuoWWWX/md-king/releases/download/v1.1.10/md-king_1.1.10_x64-setup.exe" }],
    },
  });
});

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("一键更新在下载校验后先保留最新草稿，再启动安装", async () => {
  const id = useDocumentTabsStore.getState().openScratchTab({ title: "未保存文档", content: "草稿", dirty: true });
  useDocumentTabsStore.getState().updateTabContent(id, "刚刚输入的新内容");
  await useUpdaterStore.getState().startDownload();
  assert.equal(useUpdaterStore.getState().status, "installing");
  assert.ok(commands.indexOf("save-drafts") < commands.indexOf("launch_update_installer"));
  assert.equal(JSON.parse([...storage.values()][0]).tabs[0].content, "刚刚输入的新内容");
  assert.equal(commands.filter(command => command === "launch_update_installer").length, 1);
});

test("取消下载后不会报失败，也不会自动安装", async () => {
  let rejectDownload!: (reason: Error) => void;
  let downloadStarted!: () => void;
  const started = new Promise<void>(resolve => { downloadStarted = resolve; });
  invokeCommand = async (command) => {
    if (command === "download_update_installer") {
      downloadStarted();
      return new Promise((_, reject) => { rejectDownload = reject; });
    }
    return 1;
  };
  const download = useUpdaterStore.getState().startDownload();
  await started;
  await useUpdaterStore.getState().cancelDownload();
  assert.equal(useUpdaterStore.getState().status, "cancelling");
  await useUpdaterStore.getState().startDownload();
  assert.equal(commands.filter(command => command === "download_update_installer").length, 1);
  rejectDownload(new Error("下载已被用户取消"));
  await download;
  assert.equal(useUpdaterStore.getState().status, "available");
  assert.equal(useUpdaterStore.getState().errorMessage, null);
  assert.ok(!commands.includes("launch_update_installer"));
});

test("草稿无法持久化时保留软件和安装包，允许恢复后重试", async () => {
  failStorage = true;
  await useUpdaterStore.getState().startDownload();
  assert.equal(useUpdaterStore.getState().status, "ready_to_install");
  assert.match(useUpdaterStore.getState().errorMessage ?? "", /草稿存储空间不足/);
  assert.ok(!commands.includes("launch_update_installer"));
  failStorage = false;
  await useUpdaterStore.getState().installAndRelaunch();
  assert.equal(useUpdaterStore.getState().status, "installing");
  assert.equal(commands.filter(command => command === "download_update_installer").length, 1);
  assert.ok(commands.includes("launch_update_installer"));
});

test("compareSemver 正确对比主次补丁版本", () => {
  assert.equal(compareSemver("1.1.9", "1.1.8"), 1);
  assert.equal(compareSemver("1.1.8", "1.1.9"), -1);
  assert.equal(compareSemver("1.1.8", "1.1.8"), 0);

  // 带 'v' 前缀
  assert.equal(compareSemver("v1.2.0", "1.1.8"), 1);
  assert.equal(compareSemver("1.1.8", "v1.2.0"), -1);
  assert.equal(compareSemver("v2.0.0", "v1.9.9"), 1);

  // 位数不足补零
  assert.equal(compareSemver("1.2", "1.1.9"), 1);
  assert.equal(compareSemver("1.1", "1.1.0"), 0);
});

test("启动或重新打开时静默检查会显示新版本提示，不自动弹窗或安装", async () => {
  const release = useUpdaterStore.getState().latestRelease;
  invokeCommand = async () => JSON.stringify(release);
  useUpdaterStore.setState({ currentVersion: "1.1.9", status: "idle", hasUpdate: false, latestRelease: null, dialogOpen: false, ignoredVersions: [] });
  assert.equal(await useUpdaterStore.getState().checkForUpdates({ silent: true }), true);
  assert.equal(useUpdaterStore.getState().hasUpdate, true);
  assert.equal(useUpdaterStore.getState().status, "available");
  assert.equal(useUpdaterStore.getState().latestRelease?.tag_name, "v1.1.10");
  assert.equal(useUpdaterStore.getState().dialogOpen, false);
  assert.deepEqual(commands, ["fetch_latest_release"]);
});

test("重新打开窗口检查更新时，不打断正在检查、下载或安装的任务", async () => {
  for (const status of ["checking", "downloading", "cancelling", "installing", "ready_to_install"] as const) {
    useUpdaterStore.setState({ status });
    assert.equal(await useUpdaterStore.getState().checkForUpdates({ silent: true }), false);
    assert.equal(useUpdaterStore.getState().status, status);
  }
  assert.deepEqual(commands, []);
});

test("检查新版本尚未结束时，不启动旧版本安装包下载", async () => {
  useUpdaterStore.setState({ status: "checking" });
  await useUpdaterStore.getState().startDownload();
  assert.deepEqual(commands, []);
  assert.equal(useUpdaterStore.getState().status, "checking");
});

function newerRelease() {
  return {
    ...useUpdaterStore.getState().latestRelease!, tag_name: "v1.1.11",
    assets: [{ name: "md-king_1.1.11_x64-setup.exe", size: 6, browser_download_url: "https://github.com/GuoWWWX/md-king/releases/download/v1.1.11/md-king_1.1.11_x64-setup.exe" }],
  };
}

test("下载中可检测新版，检测不会取消或清空旧进度，旧包完成后不安装", async () => {
  let complete!: (path: string) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const release = newerRelease();
  invokeCommand = async command => {
    if (command === "fetch_latest_release") return JSON.stringify(release);
    if (command === "download_update_installer") {
      started();
      return new Promise<string>(resolve => { complete = resolve; });
    }
    return 1;
  };
  const download = useUpdaterStore.getState().startDownload();
  await ready;
  progressListener({ payload: { version: "v1.1.10", percent: 50, transferred: 2, total: 3, speed_bytes_per_sec: 1 } });
  assert.equal(await useUpdaterStore.getState().checkForUpdates(), true);
  assert.equal(useUpdaterStore.getState().status, "downloading");
  assert.equal(useUpdaterStore.getState().latestRelease?.tag_name, "v1.1.11");
  assert.equal(useUpdaterStore.getState().downloadProgress.transferred, 2);
  assert.ok(!commands.includes("cancel_update_download"));
  complete("C:/temp/old.exe");
  await download;
  assert.equal(useUpdaterStore.getState().status, "available");
  assert.ok(!commands.includes("launch_update_installer"));
});

test("点击下载新版时先等待旧下载取消，再向后端请求新版", async () => {
  let rejectOld!: (reason: Error) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const versions: unknown[] = [];
  const release = newerRelease();
  invokeCommand = async (command, args) => {
    if (command === "fetch_latest_release") return JSON.stringify(release);
    if (command === "cancel_update_download") { rejectOld(new Error("下载已被用户取消")); return; }
    if (command === "download_update_installer") {
      versions.push(args?.version);
      if (args?.version === "v1.1.10") {
        started();
        return new Promise((_, reject) => { rejectOld = reject; });
      }
      return "C:/temp/new.exe";
    }
    return 1;
  };
  const oldDownload = useUpdaterStore.getState().startDownload();
  await ready;
  await useUpdaterStore.getState().checkForUpdates();
  await useUpdaterStore.getState().startDownload();
  await oldDownload;
  assert.deepEqual(versions, ["v1.1.10", "v1.1.11"]);
  assert.equal(useUpdaterStore.getState().installerPath, "C:/temp/new.exe");
  assert.equal(useUpdaterStore.getState().status, "installing");
});

test("下载失败和取消后保留续传进度，重新下载同版本不会清零", async () => {
  let calls = 0;
  invokeCommand = async command => {
    if (command !== "download_update_installer") return 1;
    calls++;
    if (calls === 1) {
      progressListener({ payload: { version: "v1.1.10", percent: 50, transferred: 2, total: 3, speed_bytes_per_sec: 1 } });
      throw new Error("下载数据读取中断");
    }
    assert.equal(useUpdaterStore.getState().downloadProgress.transferred, 2);
    return "C:/temp/resumed.exe";
  };
  await useUpdaterStore.getState().startDownload();
  assert.equal(useUpdaterStore.getState().downloadProgress.transferred, 2);
  await useUpdaterStore.getState().startDownload();
  assert.equal(calls, 2);
  assert.equal(useUpdaterStore.getState().status, "installing");
});

test("下载完成时等待正在进行的版本检测，避免安装刚刚被替代的旧版", async () => {
  let completeDownload!: (path: string) => void;
  let completeCheck!: (json: string) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const release = newerRelease();
  invokeCommand = async command => {
    if (command === "fetch_latest_release") return new Promise<string>(resolve => { completeCheck = resolve; });
    if (command === "download_update_installer") {
      started();
      return new Promise<string>(resolve => { completeDownload = resolve; });
    }
    return 1;
  };
  const download = useUpdaterStore.getState().startDownload();
  await ready;
  const check = useUpdaterStore.getState().checkForUpdates();
  completeDownload("C:/temp/old.exe");
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!commands.includes("launch_update_installer"));
  completeCheck(JSON.stringify(release));
  await Promise.all([download, check]);
  assert.equal(useUpdaterStore.getState().status, "available");
  assert.ok(!commands.includes("launch_update_installer"));
});

test("已校验的旧包在检测到新版后不能再启动安装", async () => {
  const release = newerRelease();
  invokeCommand = async command => command === "fetch_latest_release" ? JSON.stringify(release) : 1;
  useUpdaterStore.setState({ status: "ready_to_install", installerPath: "C:/temp/old.exe", downloadVersion: "v1.1.10" });
  await useUpdaterStore.getState().checkForUpdates();
  assert.equal(useUpdaterStore.getState().status, "available");
  assert.equal(useUpdaterStore.getState().installerPath, null);
  await useUpdaterStore.getState().installAndRelaunch();
  assert.ok(!commands.includes("launch_update_installer"));
});
