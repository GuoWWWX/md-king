import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauriEnvironment, resolvePreviewImageSource } from "@/lib/tauri";
import { registerBrowserPreviewImage, remapBrowserPreviewImages } from "@/lib/browser-preview-images";
import { isSupportedImagePath } from "@/lib/image-files";
import type { VaultEntry, VaultFileContent, VaultImageImport, VaultListing, VaultSearchMatch, VaultSearchOptions, VaultSearchResponse, VaultWriteParams, VaultWriteResult } from "@/types/vault";

/// vault 的 7 个 command 单独放这里而不是塞进 tauri.ts：后者已近 400 行，
/// 且 vault 的浏览器 mock 需要一整套有状态的内存文件系统，混在一起会互相干扰。

const BROWSER_VAULT_ROOT = "D:/示例仓库";

/// 故意加的延迟：让保存状态机的 saving → saved 过渡在 pnpm dev 下肉眼可见，
/// 否则浏览器里瞬时返回，UI 的中间态永远调试不到。
const MOCK_LATENCY_MS = 200;
const MAX_SEARCH_RESULTS = 200;
const MAX_SEARCH_MATCHES_PER_FILE = 6;

type MockFile = {
  content: string;
  modifiedMs: number;
};

/// 目录用 Set 单独存：空目录在 files 里没有任何条目，光靠文件路径推不出来。
const mockDirs = new Set<string>(["笔记", "笔记/技术", "草稿", "图片"]);
const mockFiles = new Map<string, MockFile>();

function seedMockVault() {
  const seedAt = Date.now() - 86_400_000;
  const seeds: Array<[string, string]> = [
    ["README.md", "# 示例仓库\n\n这是浏览器预览用的内存 vault，所有改动只存在于当前标签页。\n\n- 支持新建 / 重命名 / 删除\n- 写入时会模拟乐观锁冲突\n"],
    ["笔记/日常记录.md", "# 日常记录\n\n## 今天\n\n- [ ] 验证文件树展开折叠\n- [ ] 验证搜索过滤\n"],
    ["笔记/技术/CodeMirror 装饰层.md", "# CodeMirror 装饰层\n\n跨行 replace 必须由 StateField 提供，放进 ViewPlugin 会静默失效。\n"],
    ["笔记/技术/Tauri 命令约定.md", "# Tauri 命令约定\n\n所有 vault 错误统一为 `CODE|中文提示` 格式。\n"],
    ["草稿/未命名草稿.md", "草稿内容\n"],
  ];

  for (const [path, content] of seeds) {
    mockFiles.set(path, { content, modifiedMs: seedAt });
  }
  const demoImage = "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2248%22%20height%3D%2232%22%3E%3Crect%20width%3D%2248%22%20height%3D%2232%22%20fill%3D%22%232563eb%22%2F%3E%3C%2Fsvg%3E";
  mockFiles.set("图片/示例.svg", { content: "", modifiedMs: seedAt });
  registerBrowserPreviewImage(`${BROWSER_VAULT_ROOT}/图片/示例.svg`, demoImage);
}

seedMockVault();

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => window.setTimeout(() => resolve(value), MOCK_LATENCY_MS));
}

function vaultError(code: string, message: string) {
  return new Error(`${code}|${message}`);
}

function parentOf(path: string) {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function baseNameOf(path: string) {
  const index = path.lastIndexOf("/");
  return index < 0 ? path : path.slice(index + 1);
}

function joinPath(parent: string, name: string) {
  return parent ? `${parent}/${name}` : name;
}

function nextAvailablePath(parent: string, name: string) {
  if (!mockPathExists(joinPath(parent, name))) return joinPath(parent, name);
  const dotIndex = name.lastIndexOf(".");
  const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const extension = dotIndex > 0 ? name.slice(dotIndex) : "";
  for (let index = 1; index < 1000; index += 1) {
    const path = joinPath(parent, `${stem} (${index})${extension}`);
    if (!mockPathExists(path)) return path;
  }
  throw vaultError("EXISTS", "无法找到可用的图片文件名");
}

function screenshotImageName(extension: string) {
  const now = new Date();
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  const milliseconds = String(now.getMilliseconds()).padStart(3, "0");
  return `截图-${now.getFullYear()}${twoDigits(now.getMonth() + 1)}${twoDigits(now.getDate())}-${twoDigits(now.getHours())}${twoDigits(now.getMinutes())}${twoDigits(now.getSeconds())}-${milliseconds}.${extension}`;
}

/// mock 侧也要跑一遍名称校验，否则浏览器里能建出 Rust 端会拒绝的名字，
/// 到桌面端才发现 UI 少了错误分支。
function assertValidName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw vaultError("INVALID_NAME", "名称不能为空");
  if (/[\\/:*?"<>|]/.test(trimmed)) throw vaultError("INVALID_NAME", "名称不能包含 \\ / : * ? \" < > | 字符");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(trimmed)) throw vaultError("INVALID_NAME", "该名称是 Windows 保留名，请换一个");
  if (/[ .]$/.test(trimmed)) throw vaultError("INVALID_NAME", "名称不能以空格或点结尾");
}

function mockPathExists(path: string) {
  return mockFiles.has(path) || mockDirs.has(path);
}

function toEntry(path: string, isDir: boolean): VaultEntry {
  if (isDir) {
    const prefix = `${path}/`;
    const hasChildren = [...mockFiles.keys(), ...mockDirs].some((candidate) => candidate.startsWith(prefix));
    return { path, name: baseNameOf(path), isDir: true, size: 0, modifiedMs: 0, hasChildren };
  }

  const file = mockFiles.get(path);
  return {
    path,
    name: baseNameOf(path),
    isDir: false,
    size: file ? new TextEncoder().encode(file.content).length : 0,
    modifiedMs: file?.modifiedMs ?? 0,
    hasChildren: false,
  };
}

function mockListing(dir?: string, recursive = true, root = BROWSER_VAULT_ROOT): VaultListing {
  const prefix = dir ? `${dir}/` : "";
  const inScope = (path: string) => (prefix ? path.startsWith(prefix) : true) && path !== dir;
  const atRequestedDepth = (path: string) => (recursive ? true : parentOf(path) === (dir ?? ""));

  const entries = [
    ...[...mockDirs].filter((path) => inScope(path) && atRequestedDepth(path)).map((path) => toEntry(path, true)),
    ...[...mockFiles.keys()].filter((path) => inScope(path) && atRequestedDepth(path)).map((path) => toEntry(path, false)),
  ];

  entries.sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));
  return { root, entries, truncated: false, skippedDirs: 0 };
}

/// 桌面端由 plugin-dialog 选目录；浏览器端返回固定的示例 root，让整条 UI 链路能跑通。
export async function selectVaultDirectory() {
  if (!isTauriEnvironment()) {
    return delay<string | undefined>(BROWSER_VAULT_ROOT);
  }

  const selected = await open({ directory: true, multiple: false, title: "选择 Markdown 仓库目录" });
  if (Array.isArray(selected)) return selected[0];
  return selected ?? undefined;
}

export function openVault(path: string) {
  if (isTauriEnvironment()) {
    return invoke<VaultListing>("open_vault", { path });
  }

  return delay(mockListing(undefined, true, path.trim() || BROWSER_VAULT_ROOT));
}

export function removeRecentVault(root: string) {
  if (isTauriEnvironment()) {
    return invoke<void>("remove_recent_vault", { root });
  }

  return delay<void>(undefined);
}

export function listVaultEntries(root: string, dir: string | undefined, recursive: boolean) {
  if (isTauriEnvironment()) {
    return invoke<VaultListing>("list_vault_entries", { root, dir, recursive });
  }

  return delay(mockListing(dir, recursive, root));
}

export function readVaultFile(root: string, path: string) {
  if (isTauriEnvironment()) {
    return invoke<VaultFileContent>("read_vault_file", { root, path });
  }

  const file = mockFiles.get(path);
  if (!file) return Promise.reject(vaultError("NOT_FOUND", `文件不存在：${path}`));

  return delay<VaultFileContent>({
    path,
    content: file.content,
    eol: "lf",
    hasBom: false,
    modifiedMs: file.modifiedMs,
    size: new TextEncoder().encode(file.content).length,
  });
}

function createBrowserSearchMatcher(query: string, options: VaultSearchOptions) {
  const source = options.regexp ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = options.wholeWord ? `\\b(?:${source})\\b` : source;
  try {
    return new RegExp(pattern, options.caseSensitive ? "u" : "iu");
  } catch {
    throw new Error("INVALID_QUERY|正则表达式无效，请检查后重试。");
  }
}

function browserSearchPreview(line: string, start: number, end: number) {
  const before = line.slice(0, start);
  const matched = line.slice(start, end);
  const after = line.slice(end);
  const shownBefore = before.slice(-60);
  const shownMatch = matched.slice(0, 80);
  let preview = `${before.length > shownBefore.length ? "…" : ""}${shownBefore}`;
  const previewMatchStart = preview.length;
  preview += shownMatch;
  const previewMatchEnd = preview.length;
  if (shownMatch.length < matched.length) preview += "…";
  else preview += `${after.slice(0, 80)}${after.length > 80 ? "…" : ""}`;
  return { preview, previewMatchStart, previewMatchEnd };
}

export function searchVault(root: string, query: string, options: VaultSearchOptions) {
  if (isTauriEnvironment()) {
    return invoke<VaultSearchResponse>("search_vault", { root, query, options });
  }

  if (!query.trim()) {
    return delay<VaultSearchResponse>({ results: [], truncated: false, scannedFiles: 0, skippedFiles: 0 });
  }
  let matcher: RegExp;
  try {
    matcher = createBrowserSearchMatcher(query, options);
  } catch (error) {
    return Promise.reject(error);
  }

  const files = [...mockFiles.entries()].filter(([path]) => /\.(?:md|markdown|txt)$/i.test(path));
  const fileNameResults: VaultSearchMatch[] = [];
  const contentResults: VaultSearchMatch[] = [];

  for (const [path] of files) {
    const name = baseNameOf(path);
    const match = matcher.exec(name);
    if (match) {
      fileNameResults.push({
        path,
        name,
        kind: "fileName",
        line: null,
        preview: "",
        matchStart: match.index,
        matchEnd: match.index + match[0].length,
        previewMatchStart: null,
        previewMatchEnd: null,
      });
    }
  }

  for (const [path, file] of files) {
    const name = baseNameOf(path);
    let matchesInFile = 0;
    for (const [index, line] of file.content.split(/\r?\n/).entries()) {
      const match = matcher.exec(line);
      if (!match) continue;
      const matchStart = match.index;
      const matchEnd = match.index + match[0].length;
      const preview = browserSearchPreview(line, matchStart, matchEnd);
      contentResults.push({
        path,
        name,
        kind: "content",
        line: index + 1,
        preview: preview.preview,
        matchStart,
        matchEnd,
        previewMatchStart: preview.previewMatchStart,
        previewMatchEnd: preview.previewMatchEnd,
      });
      matchesInFile += 1;
      if (matchesInFile >= MAX_SEARCH_MATCHES_PER_FILE) break;
    }
  }

  const allResults = [...fileNameResults, ...contentResults];
  return delay<VaultSearchResponse>({
    results: allResults.slice(0, MAX_SEARCH_RESULTS),
    truncated: allResults.length > MAX_SEARCH_RESULTS,
    scannedFiles: files.length,
    skippedFiles: 0,
  });
}

export function writeVaultFile(params: VaultWriteParams) {
  const { root, path, content, eol, hasBom, expectedModifiedMs, allowEmpty = false } = params;

  if (isTauriEnvironment()) {
    return invoke<VaultWriteResult>("write_vault_file", { root, path, content, eol, hasBom, expectedModifiedMs, allowEmpty });
  }

  const file = mockFiles.get(path);
  if (!file) return Promise.reject(vaultError("NOT_FOUND", `文件不存在：${path}`));
  if (expectedModifiedMs !== undefined && expectedModifiedMs !== file.modifiedMs) {
    return Promise.reject(vaultError("CONFLICT", "文件已被其他程序修改，请选择保留哪一份"));
  }
  if (!allowEmpty && !content && file.content) {
    return Promise.reject(vaultError("TOO_LARGE", "拒绝把非空文件写成空文件"));
  }

  const modifiedMs = Date.now();
  mockFiles.set(path, { content, modifiedMs });
  return delay<VaultWriteResult>({ path, modifiedMs, size: new TextEncoder().encode(content).length });
}

export function createVaultEntry(root: string, parentDir: string, name: string, isDir: boolean) {
  if (isTauriEnvironment()) {
    return invoke<VaultEntry>("create_vault_entry", { root, parentDir, name, isDir });
  }

  try {
    assertValidName(name);
  } catch (error) {
    return Promise.reject(error);
  }

  const finalName = isDir || /\.(md|markdown|txt)$/i.test(name.trim()) ? name.trim() : `${name.trim()}.md`;
  const path = joinPath(parentDir, finalName);
  if (mockPathExists(path)) return Promise.reject(vaultError("EXISTS", `已存在同名${isDir ? "文件夹" : "文件"}：${finalName}`));

  if (isDir) {
    mockDirs.add(path);
  } else {
    mockFiles.set(path, { content: "", modifiedMs: Date.now() });
  }

  return delay(toEntry(path, isDir));
}

export function renameVaultEntry(root: string, path: string, newName: string) {
  if (isTauriEnvironment()) {
    return invoke<VaultEntry>("rename_vault_entry", { root, path, newName });
  }

  try {
    assertValidName(newName);
  } catch (error) {
    return Promise.reject(error);
  }

  const isDir = mockDirs.has(path);
  if (!isDir && !mockFiles.has(path)) return Promise.reject(vaultError("NOT_FOUND", `目标不存在：${path}`));

  const nextPath = joinPath(parentOf(path), newName.trim());
  if (nextPath !== path && mockPathExists(nextPath)) {
    return Promise.reject(vaultError("EXISTS", `已存在同名${isDir ? "文件夹" : "文件"}：${newName}`));
  }

  if (isDir) {
    // 目录改名要连带搬走所有后代，否则子节点的 path 前缀会失配、树上直接消失。
    const prefix = `${path}/`;
    for (const dir of [...mockDirs]) {
      if (dir === path || dir.startsWith(prefix)) {
        mockDirs.delete(dir);
        mockDirs.add(nextPath + dir.slice(path.length));
      }
    }
    for (const [filePath, file] of [...mockFiles]) {
      if (filePath.startsWith(prefix)) {
        mockFiles.delete(filePath);
        mockFiles.set(nextPath + filePath.slice(path.length), file);
      }
    }
  } else {
    const file = mockFiles.get(path);
    mockFiles.delete(path);
    mockFiles.set(nextPath, { content: file?.content ?? "", modifiedMs: Date.now() });
  }

  remapBrowserPreviewImages(`${root}/${path}`, `${root}/${nextPath}`);

  return delay(toEntry(nextPath, isDir));
}

export function moveVaultEntry(root: string, path: string, targetDir: string) {
  if (isTauriEnvironment()) {
    return invoke<VaultEntry>("move_vault_entry", { root, path, targetDir });
  }

  const isDir = mockDirs.has(path);
  if (!isDir && !mockFiles.has(path)) return Promise.reject(vaultError("NOT_FOUND", "要移动的文件不存在"));
  if (targetDir && !mockDirs.has(targetDir)) return Promise.reject(vaultError("NOT_FOUND", "目标文件夹不存在"));
  if (isDir && targetDir && (targetDir === path || targetDir.startsWith(`${path}/`))) {
    return Promise.reject(vaultError("INVALID_NAME", "不能将文件夹移动到自身或其子目录中"));
  }

  const nextPath = joinPath(targetDir, baseNameOf(path));
  if (nextPath === path) return delay(toEntry(path, isDir));
  if (mockPathExists(nextPath)) return Promise.reject(vaultError("EXISTS", "目标文件夹中已有同名文件或目录"));

  if (isDir) {
    const prefix = `${path}/`;
    for (const dir of [...mockDirs]) {
      if (dir === path || dir.startsWith(prefix)) {
        mockDirs.delete(dir);
        mockDirs.add(nextPath + dir.slice(path.length));
      }
    }
    for (const [filePath, file] of [...mockFiles]) {
      if (filePath.startsWith(prefix)) {
        mockFiles.delete(filePath);
        mockFiles.set(nextPath + filePath.slice(path.length), file);
      }
    }
  } else {
    const file = mockFiles.get(path);
    mockFiles.delete(path);
    mockFiles.set(nextPath, { content: file?.content ?? "", modifiedMs: Date.now() });
  }

  remapBrowserPreviewImages(`${root}/${path}`, `${root}/${nextPath}`);

  return delay(toEntry(nextPath, isDir));
}

export function deleteVaultEntry(root: string, path: string, recursive: boolean) {
  if (isTauriEnvironment()) {
    return invoke<void>("delete_vault_entry", { root, path, recursive });
  }

  const isDir = mockDirs.has(path);
  if (!isDir && !mockFiles.has(path)) return Promise.reject(vaultError("NOT_FOUND", `目标不存在：${path}`));

  if (isDir) {
    const prefix = `${path}/`;
    const descendants = [...mockDirs, ...mockFiles.keys()].filter((candidate) => candidate.startsWith(prefix));
    if (descendants.length > 0 && !recursive) {
      return Promise.reject(vaultError("EXISTS", "目录非空，需要确认递归删除"));
    }
    for (const candidate of descendants) {
      mockDirs.delete(candidate);
      mockFiles.delete(candidate);
    }
    mockDirs.delete(path);
  } else {
    mockFiles.delete(path);
  }

  return delay<void>(undefined);
}

export function copyVaultEntry(root: string, sourcePath: string, targetDir: string) {
  if (isTauriEnvironment()) {
    return invoke<VaultEntry>("copy_vault_entry", { root, sourcePath, targetDir });
  }

  const isDir = mockDirs.has(sourcePath);
  if (!isDir && !mockFiles.has(sourcePath)) {
    return Promise.reject(vaultError("NOT_FOUND", "要复制的文件不存在"));
  }
  if (targetDir && !mockDirs.has(targetDir)) {
    return Promise.reject(vaultError("NOT_FOUND", "目标文件夹不存在"));
  }
  if (isDir && targetDir && targetDir.startsWith(`${sourcePath}/`)) {
    return Promise.reject(vaultError("INVALID_NAME", "不能将文件夹复制到自身子目录中"));
  }

  const baseName = baseNameOf(sourcePath);
  let finalName = baseName;
  let counter = 1;

  // 自动重命名避免冲突
  while (mockPathExists(joinPath(targetDir, finalName))) {
    const dotIndex = baseName.lastIndexOf(".");
    if (dotIndex > 0) {
      const stem = baseName.slice(0, dotIndex);
      const ext = baseName.slice(dotIndex);
      finalName = `${stem} (${counter})${ext}`;
    } else {
      finalName = `${baseName} (${counter})`;
    }
    counter++;
    if (counter > 999) {
      return Promise.reject(vaultError("EXISTS", "无法找到可用的文件名"));
    }
  }

  const targetPath = joinPath(targetDir, finalName);

  if (isDir) {
    // 递归复制目录
    const prefix = `${sourcePath}/`;
    mockDirs.add(targetPath);

    for (const dir of [...mockDirs]) {
      if (dir.startsWith(prefix)) {
        const relativePath = dir.slice(prefix.length);
        mockDirs.add(joinPath(targetPath, relativePath));
      }
    }

    for (const [filePath, file] of [...mockFiles]) {
      if (filePath.startsWith(prefix)) {
        const relativePath = filePath.slice(prefix.length);
        mockFiles.set(joinPath(targetPath, relativePath), {
          content: file.content,
          modifiedMs: Date.now(),
        });
      }
    }
  } else {
    const file = mockFiles.get(sourcePath);
    mockFiles.set(targetPath, {
      content: file?.content ?? "",
      modifiedMs: Date.now(),
    });
  }

  return delay(toEntry(targetPath, isDir));
}

export function copyExternalVaultFile(root: string, sourcePath: string, targetDir: string) {
  if (isTauriEnvironment()) {
    return invoke<VaultEntry>("copy_external_vault_file", { root, sourcePath, targetDir });
  }
  return Promise.reject(new Error("浏览器环境无法读取系统剪贴板文件"));
}

export function importVaultImageFromPath(root: string, markdownPath: string, sourcePath: string) {
  if (isTauriEnvironment()) {
    return invoke<VaultImageImport>("import_vault_image_from_path", { root, markdownPath, sourcePath });
  }
  return Promise.reject(new Error("浏览器环境无法读取本机图片路径"));
}

export function importVaultImageData(root: string, markdownPath: string, dataBase64: string, extension: string) {
  if (isTauriEnvironment()) {
    return invoke<VaultImageImport>("import_vault_image_data", { root, markdownPath, dataBase64, extension });
  }

  if (!mockFiles.has(markdownPath)) return Promise.reject(vaultError("NOT_FOUND", "当前文档不存在"));
  const normalizedExtension = extension.trim().replace(/^\./, "").toLowerCase();
  if (!isSupportedImagePath(`image.${normalizedExtension}`)) {
    return Promise.reject(vaultError("INVALID_NAME", "不支持的图片格式"));
  }
  const imageDir = ".md-king/img";
  mockDirs.add(".md-king");
  mockDirs.add(imageDir);
  const imagePath = nextAvailablePath(imageDir, screenshotImageName(normalizedExtension));
  mockFiles.set(imagePath, { content: "", modifiedMs: Date.now() });
  registerBrowserPreviewImage(`${root.replace(/[\\/]+$/, "")}/${imagePath}`, dataBase64);
  return delay<VaultImageImport>({ entry: toEntry(imagePath, false), imageDir: toEntry(imageDir, true) });
}

export function resolveVaultImageSource(root: string, path: string) {
  return resolvePreviewImageSource(`${root.replace(/[\\/]+$/, "")}/${path}`);
}

export function setVaultEntryClipboard(root: string, paths: string[]) {
  if (isTauriEnvironment()) {
    return invoke<void>("set_vault_entry_clipboard", { root, paths });
  }
  return Promise.resolve();
}

export function showInExplorer(path: string) {
  if (isTauriEnvironment()) {
    return invoke<void>("show_in_explorer", { path });
  }

  // 浏览器环境无法打开文件管理器
  return Promise.reject(new Error("浏览器环境不支持打开文件管理器"));
}

export async function copyTextToClipboard(text: string) {
  if (isTauriEnvironment()) {
    // 桌面版不能依赖 WebView 的 Clipboard Permissions；由原生端统一写入。
    return invoke<void>("copy_text_to_clipboard", { text });
  }

  // 浏览器环境
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  return Promise.reject(new Error("剪贴板 API 不可用"));
}

export async function readPathsFromClipboard(): Promise<string[]> {
  if (!isTauriEnvironment()) return [];
  return invoke<string[]>("read_clipboard_file_paths");
}
