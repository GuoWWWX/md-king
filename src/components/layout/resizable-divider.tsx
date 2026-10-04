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
  /// 收起态仍保留命中区。拖过最小尺寸一小段才收起，反向拖过同样距离才恢复，
  /// 既避免误触，也让一次连续拖拽能直接来回切换。
  collapsed?: boolean;
  /// 某些侧栏首次展开必须通过显式按钮；关闭后的边缘命中区不再启动拖拽。
  allowCollapsedDrag?: boolean;
  collapseThreshold?: number;
  onCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
  /** 覆盖实际拖拽命中区；侧栏紧邻滚动条时可把命中区限制在卡片缝隙内。 */
  handleClassName?: string;
};

export const RESIZABLE_PANEL_COLLAPSE_THRESHOLD = 24;

/// 抽取自 convert-page 里两处几乎一样的 pointer 拖拽逻辑。
/// 监听挂在 window 而非元素上：拖快时指针会甩出这条 6px 宽的细条，
/// 只监听元素会掉帧、甚至丢掉 pointerup 导致拖拽状态卡住。
export function ResizableDivider({
  orientation = "vertical",
  size,
  min,
  max,
  onResize,
  ariaLabel,
  from = "start",
  collapsed = false,
  allowCollapsedDrag = true,
  collapseThreshold = RESIZABLE_PANEL_COLLAPSE_THRESHOLD,
  onCollapsedChange,
  className,
  handleClassName,
}: ResizableDividerProps) {
  const isDraggingRef = useRef(false);
  const dragDisabled = collapsed && !allowCollapsedDrag;

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (dragDisabled) return;
    event.preventDefault();

    const divider = event.currentTarget;
    const rect = divider.getBoundingClientRect();
    let origin = orientation === "vertical"
      ? (from === "start" ? rect.left : rect.right)
      : (from === "start" ? rect.top : rect.bottom);

    let startSize = size;
    if (startSize === undefined) {
      const sibling = from === "start" ? divider.previousElementSibling : divider.nextElementSibling;
      const siblingRect = sibling?.getBoundingClientRect();
      startSize = orientation === "vertical" ? (siblingRect?.width ?? min) : (siblingRect?.height ?? min);
    }
    let baseSize = collapsed ? min : startSize;
    let collapsedDuringDrag = collapsed;

    isDraggingRef.current = true;
    divider.setPointerCapture(event.pointerId);
    document.body.style.cursor = orientation === "vertical" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    const move = (moveEvent: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const pointerPosition = orientation === "vertical" ? moveEvent.clientX : moveEvent.clientY;
      const delta = pointerPosition - origin;
      const next = from === "start" ? baseSize + delta : baseSize - delta;

      if (onCollapsedChange) {
        if (!collapsedDuringDrag && next <= min - collapseThreshold) {
          // 先写回最小值，工具栏直接展开时也保持预期尺寸。
          onResize(min);
          collapsedDuringDrag = true;
          onCollapsedChange(true);
          return;
        }

        if (collapsedDuringDrag && next >= min + collapseThreshold) {
          // 恢复的一刻固定落在最小宽度；后续移动才继续放大，避免跳宽。
          onResize(min);
          collapsedDuringDrag = false;
          origin = pointerPosition;
          baseSize = min;
          onCollapsedChange(false);
          return;
        }

        if (collapsedDuringDrag) return;
      }

      onResize(Math.min(max, Math.max(min, Math.round(next))));
    };

    const stop = () => {
      try {
        if (divider.hasPointerCapture(event.pointerId)) {
          divider.releasePointerCapture(event.pointerId);
        }
      } catch {
        // WebView 已释放指针
      }
      isDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
  }

  return (
    // 外层零尺寸、只作定位上下文：分隔条一旦真的参与 flex 布局，自身宽度
    // 加上两侧 gap 会在面板之间撑出一道明显比别处宽的缝。让它浮在既有
    // gap 上，命中区域向两侧扩，视觉上就只剩那道 gap 本身。
    <div className={cn("relative self-stretch", orientation === "vertical" ? "w-0" : "h-0", className)}>
      <div
        role="separator"
        aria-label={ariaLabel}
        aria-orientation={orientation}
        className={cn(
          "group absolute flex items-center justify-center",
          orientation === "vertical"
            ? "inset-y-0 left-1/2 w-4 -translate-x-1/2 cursor-col-resize"
            : "inset-x-0 top-1/2 h-4 -translate-y-1/2 cursor-row-resize",
          dragDisabled && "pointer-events-none cursor-default",
          handleClassName,
        )}
        onPointerDown={dragDisabled ? undefined : handlePointerDown}
        aria-disabled={dragDisabled || undefined}
      >
        <span
          className={cn(
            "rounded-full bg-transparent transition",
            orientation === "vertical" ? "h-16 w-1 group-hover:h-24" : "h-1 w-16 group-hover:w-24",
          )}
        />
      </div>
    </div>
  );
}
