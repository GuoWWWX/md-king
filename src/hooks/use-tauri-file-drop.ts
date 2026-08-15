import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriEnvironment } from "@/lib/tauri";

const SUPPORTED_TEXT_PATTERN = /\.(md|markdown|txt)$/i;
const SUPPORTED_IMAGE_PATTERN = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

type DropHandler = (drop: { paths: string[]; position: { x: number; y: number } }) => void | Promise<void>;

/**
 * 监听桌面端窗口级的文件拖放。
 *
 * 浏览器的 drop 事件只给得到 File 对象，拿不到真实磁盘路径，因此没法把
 * 拖进来的文件当成「有源文件的文档」处理。Tauri 的 onDragDropEvent 给的是
 * 绝对路径，所以桌面端单独走这条通道——这也是为什么这个 hook 在浏览器下
 * 直接空转，由组件自己的 HTML5 drop 兜底。
 */
export function useTauriFileDrop(onDrop: DropHandler) {
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  // 监听器只注册一次，闭包捕获的是首帧的 onDrop。放进 ref 每次渲染刷新，
  // 回调里才拿得到最新的状态，否则拖入的文档会被塞进一个早已过期的标签集合。
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    if (!isTauriEnvironment()) return undefined;

    let unlisten: (() => void) | undefined;
    let disposed = false;

    void getCurrentWindow()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "enter") {
          setIsDragging(true);
          setIsDraggingImage(payload.paths.some(isImageDropPath));
          return;
        }
        if (payload.type === "over") {
          setIsDragging(true);
          return;
        }
        if (payload.type === "leave") {
          setIsDragging(false);
          setIsDraggingImage(false);
          return;
        }

        setIsDragging(false);
        setIsDraggingImage(false);
        const supported = payload.paths.filter(isSupportedDropPath);
        if (supported.length > 0) void onDropRef.current({ paths: supported, position: payload.position });
      })
      .then((cleanup) => {
        // 注册是异步的，组件可能在 promise 落地前就卸载了，
        // 那时要立刻把刚拿到的监听器撤掉，否则它会一直挂在窗口上。
        if (disposed) cleanup();
        else unlisten = cleanup;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
    // 空依赖是刻意的：onDrop 每次渲染都是新函数，放进依赖会让窗口监听器
    // 反复注册注销。最新的回调通过上面的 ref 取。
  }, []);

  return { isDragging, isDraggingImage };
}

export function isSupportedDropPath(path: string) {
  return SUPPORTED_TEXT_PATTERN.test(path) || isImageDropPath(path);
}

export function isImageDropPath(path: string) {
  return SUPPORTED_IMAGE_PATTERN.test(path);
}
