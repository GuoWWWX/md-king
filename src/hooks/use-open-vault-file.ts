import { useCallback } from "react";
import { toast } from "sonner";
import { readVaultFile } from "@/lib/vault";
import { useVaultStore } from "@/stores/vault-store";
import { parseVaultError } from "@/lib/user-facing-errors";

/// 「在编辑器里打开 vault 里的某个文件」这一步跨了 store 与转换页两侧：
/// 既要更新 vault 的活动文件与保存基准，又要把正文喂给编辑器。
/// 编辑器正文刻意不进 store（CodeMirror 自己是文档唯一真相源），
/// 所以这里用一个订阅式回调把内容交出去，由页面自己决定怎么灌。
///
/// absolutePath 是给预览里的图片解析用的：load_preview_image 要拿源文件的
/// 父目录去解析 `![](assets/x.png)` 这类相对路径，vault 的相对路径不够用。
type OpenFileHandler = (file: { path: string; absolutePath: string; content: string }) => void;

let contentSink: OpenFileHandler | undefined;

/// 由转换页在挂载时注册，拿到打开文件的正文。
export function registerVaultContentSink(handler: OpenFileHandler | undefined) {
  contentSink = handler;
}

/// vault 内相对路径拼回绝对路径。Rust 侧统一用 `/` 分隔，
/// Windows 的 API 两种分隔符都认，所以这里不必转成反斜杠。
function joinVaultPath(root: string, relative: string) {
  return `${root.replace(/[\\/]+$/, "")}/${relative}`;
}

export function useOpenVaultFile() {
  const vaultRoot = useVaultStore((state) => state.vaultRoot);
  const setActiveFile = useVaultStore((state) => state.setActiveFile);
  const setSaveState = useVaultStore((state) => state.setSaveState);

  return useCallback(
    async (relativePath: string) => {
      if (!vaultRoot) return;

      try {
        const file = await readVaultFile(vaultRoot, relativePath);
        setActiveFile({
          path: file.path,
          eol: file.eol,
          hasBom: file.hasBom,
          modifiedMs: file.modifiedMs,
        });
        setSaveState("clean");
        contentSink?.({
          path: file.path,
          absolutePath: joinVaultPath(vaultRoot, file.path),
          content: file.content,
        });
      } catch (error) {
        const { code, message } = parseVaultError(error, "打开文件失败");
        if (code === "NOT_UTF8") {
          // 只读打开而不是直接失败：用户至少能看到内容，
          // 但绝不能让它被保存回去——那会把 GBK 文档写成乱码。
          setActiveFile(undefined);
        }
        toast.error(message);
      }
    },
    [setActiveFile, setSaveState, vaultRoot],
  );
}
