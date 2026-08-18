import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const PROJECT_WINDOW_LABEL_PREFIX = "project-";

export function vaultDisplayName(root: string) {
  const normalized = root.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/);
  return segments[segments.length - 1] || normalized;
}

export function vaultProjectWindowLabel(root: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < root.length; index += 1) {
    hash ^= root.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${PROJECT_WINDOW_LABEL_PREFIX}${(hash >>> 0).toString(36)}`;
}

export function vaultProjectWindowUrl(currentHref: string, root: string) {
  const url = new URL(currentHref);
  url.searchParams.delete("floating");
  url.searchParams.set("vault", root);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function vaultProjectWindowRoot(search: string) {
  const root = new URLSearchParams(search).get("vault")?.trim();
  return root || undefined;
}

export function restorableVaultRoot(projectRoot: string | undefined, currentRoot: string | undefined, configuredRoot: string | undefined, recentVaults: string[]) {
  if (projectRoot || currentRoot) return undefined;
  return configuredRoot?.trim() || recentVaults.find((root) => root.trim())?.trim();
}

function isTauriWindowRuntime() {
  if (typeof window === "undefined") return false;
  const tauriWindow = window as Window & { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return Boolean(tauriWindow.__TAURI_INTERNALS__ || tauriWindow.__TAURI__);
}

function waitForWindowCreation(projectWindow: WebviewWindow) {
  return new Promise<void>((resolve, reject) => {
    void projectWindow.once("tauri://created", () => resolve()).catch(reject);
    void projectWindow.once<unknown>("tauri://error", (event) => {
      reject(new Error(typeof event.payload === "string" ? event.payload : "创建项目窗口失败"));
    }).catch(reject);
  });
}

async function focusProjectWindow(projectWindow: WebviewWindow) {
  // 窗口创建/显示成功后，Windows 有时会在窗口尚未完成激活时拒绝 setFocus。
  // 这不代表打开失败，避免让调用方把已成功打开的项目窗口误报成失败。
  try {
    await projectWindow.setFocus();
  } catch {
    // 聚焦失败不影响项目窗口已创建。
  }
}

export async function openVaultProjectWindow(root: string) {
  const targetRoot = root.trim();
  if (!targetRoot) throw new Error("目录路径不能为空");
  if (!isTauriWindowRuntime()) throw new Error("浏览器预览不支持打开新的项目窗口");

  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const label = vaultProjectWindowLabel(targetRoot);
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.show();
    await focusProjectWindow(existing);
    return;
  }

  const projectWindow = new WebviewWindow(label, {
    url: vaultProjectWindowUrl(window.location.href, targetRoot),
    title: `md-king - ${vaultDisplayName(targetRoot)}`,
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f4f6f8",
    decorations: false,
    shadow: false,
  });
  await waitForWindowCreation(projectWindow);
  await focusProjectWindow(projectWindow);
}
