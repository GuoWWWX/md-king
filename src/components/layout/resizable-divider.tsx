import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";

type ResizableDividerProps = {
  orientation?: "vertical" | "horizontal";
  /// 被调整面板的当前尺寸。不传则在按下瞬间量相邻元素的实际尺寸——
  /// 后者能兼容非受控布局，但受控场景传进来更准（避免 border/padding 造成的偏差累积）。
  size?: number;
  min: number;
  max: number;
  /// 回调收到的是已 clamp 的目标尺寸，调用方直接 setState 即可。
  onResize: (size: number) => void;
  ariaLabel: string;
  /// 面板在分隔条之前（默认）时向右/下拖变大；面板在之后则方向相反。
  from?: "start" | "end";
  className?: string;
};

/// 抽取自 convert-page 里两处几乎一样的 pointer 拖拽逻辑。
/// 监听挂在 window 而非元素上：拖快时指针会甩出这条 8px 宽的细条，
/// 只监听元素会掉帧、甚至丢掉 pointerup 导致拖拽状态卡住。
export function ResizableDivider({ orientation = "vertical", size, min, max, onResize, ariaLabel, from = "start", className }: ResizableDividerProps) {
  const isDraggingRef = useRef(false);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();

    const divider = event.currentTarget;
    const rect = divider.getBoundingClientRect();
    const origin = orientation === "vertical"
      ? (from === "start" ? rect.left : rect.right)
      : (from === "start" ? rect.top : rect.bottom);

    let startSize = size;
    if (startSize === undefined) {
      const sibling = from === "start" ? divider.previousElementSibling : divider.nextElementSibling;
      const siblingRect = sibling?.getBoundingClientRect();
      startSize = orientation === "vertical" ? (siblingRect?.width ?? min) : (siblingRect?.height ?? min);
    }
    const baseSize = startSize;

    isDraggingRef.current = true;
    divider.setPointerCapture(event.pointerId);
    document.body.style.cursor = orientation === "vertical" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    const move = (moveEvent: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const delta = orientation === "vertical" ? moveEvent.clientX - origin : moveEvent.clientY - origin;
      const next = from === "start" ? baseSize + delta : baseSize - delta;
      onResize(Math.min(max, Math.max(min, Math.round(next))));
    };

    const stop = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      aria-orientation={orientation}
      className={cn(
        "group flex shrink-0 items-center justify-center",
        orientation === "vertical" ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize",
        className,
      )}
      onPointerDown={handlePointerDown}
    >
      <span
        className={cn(
          "rounded-full bg-slate-200 transition group-hover:bg-blue-400 dark:bg-zinc-700 dark:group-hover:bg-blue-500",
          orientation === "vertical" ? "h-16 w-1 group-hover:h-24" : "h-1 w-16 group-hover:w-24",
        )}
      />
    </div>
  );
}
