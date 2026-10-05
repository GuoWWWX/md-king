import { ImageIcon, Loader2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { svgDataUrl } from "@/lib/svg-image";

export { svgDataUrl };

const minZoom = 0.2;
const maxZoom = 8;
const mediaPreviewRequestEvent = "md-king:open-media-preview";

type MediaPreviewRequest = {
  src: string;
  alt?: string;
  title?: string;
};

function clampZoom(value: number) {
  return Math.min(maxZoom, Math.max(minZoom, value));
}

export function requestMediaPreview(request: MediaPreviewRequest) {
  window.dispatchEvent(new CustomEvent<MediaPreviewRequest>(mediaPreviewRequestEvent, { detail: request }));
}

export type ImageViewerHandle = {
  zoom: number;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
};

import { getPanBounds } from "./image-pan-bounds.ts";

export { getPanBounds };

export function ImageViewer({
  src,
  alt,
  className,
  paper = false,
  zoom: controlledZoom,
  onZoomChange,
  pan: controlledPan,
  onPanChange,
}: {
  src: string;
  alt?: string;
  className?: string;
  paper?: boolean;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  pan?: { x: number; y: number };
  onPanChange?: (pan: { x: number; y: number }) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [internalZoom, setInternalZoom] = useState(1);
  const zoom = controlledZoom ?? internalZoom;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  const updateZoom = useCallback((updater: number | ((curr: number) => number)) => {
    const next = typeof updater === "function" ? updater(zoomRef.current) : updater;
    const clamped = clampZoom(next);
    if (onZoomChangeRef.current) onZoomChangeRef.current(clamped);
    else setInternalZoom(clamped);
  }, []);

  const [internalPan, setInternalPan] = useState({ x: 0, y: 0 });
  const pan = controlledPan ?? internalPan;
  const panRef = useRef(pan);
  panRef.current = pan;
  const onPanChangeRef = useRef(onPanChange);
  onPanChangeRef.current = onPanChange;

  const updatePan = useCallback((updater: { x: number; y: number } | ((curr: { x: number; y: number }) => { x: number; y: number })) => {
    const next = typeof updater === "function" ? updater(panRef.current) : updater;
    if (onPanChangeRef.current) onPanChangeRef.current(next);
    else setInternalPan(next);
  }, []);

  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ active: false, x: 0, y: 0, panX: 0, panY: 0 });

  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>();

  const fitScale = naturalSize && viewport.width > 0 && viewport.height > 0
    ? Math.min(Math.max(1, viewport.width - 48) / naturalSize.width, Math.max(1, viewport.height - 48) / naturalSize.height)
    : 1;
  const imageWidth = naturalSize ? Math.max(1, naturalSize.width * fitScale * zoom) : undefined;
  const imageHeight = naturalSize ? Math.max(1, naturalSize.height * fitScale * zoom) : undefined;

  const sizeRef = useRef({ imageWidth, imageHeight, viewportWidth: viewport.width, viewportHeight: viewport.height });
  sizeRef.current = { imageWidth, imageHeight, viewportWidth: viewport.width, viewportHeight: viewport.height };

  // 仅在 src 切换时重置视图
  useEffect(() => {
    updateZoom(1);
    updatePan({ x: 0, y: 0 });
    setNaturalSize(undefined);
  }, [src, updateZoom, updatePan]);

  // 当缩放或窗口尺寸变化时，自动约束当前平移位置；若已完全处于视口内则自动居中对齐
  useEffect(() => {
    if (imageWidth === undefined || imageHeight === undefined || viewport.width === 0 || viewport.height === 0) return;
    const { canScrollX, canScrollY, maxPanX, maxPanY } = getPanBounds(imageWidth, imageHeight, viewport.width, viewport.height);
    const curPan = panRef.current;
    const clampedX = canScrollX ? Math.min(maxPanX, Math.max(-maxPanX, curPan.x)) : 0;
    const clampedY = canScrollY ? Math.min(maxPanY, Math.max(-maxPanY, curPan.y)) : 0;
    if (clampedX !== curPan.x || clampedY !== curPan.y) {
      updatePan({ x: clampedX, y: clampedY });
    }
  }, [imageWidth, imageHeight, viewport.width, viewport.height, updatePan]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;
    const update = () => setViewport({ width: node.clientWidth, height: node.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const zoomAtPoint = useCallback(
    (nextZoomOrUpdater: number | ((curr: number) => number), clientX?: number, clientY?: number) => {
      const node = viewportRef.current;
      const currZoom = zoomRef.current;
      const currPan = panRef.current;

      const nextZoomRaw = typeof nextZoomOrUpdater === "function" ? nextZoomOrUpdater(currZoom) : nextZoomOrUpdater;
      const nextZoom = clampZoom(nextZoomRaw);
      if (Math.abs(nextZoom - currZoom) < 1e-4) return;

      const ratio = nextZoom / currZoom;

      if (!node || clientX === undefined || clientY === undefined) {
        // 未提供鼠标坐标时，以视口几何中心为基准按比例缩放平移量
        updateZoom(nextZoom);
        updatePan({
          x: Math.round(currPan.x * ratio * 10) / 10,
          y: Math.round(currPan.y * ratio * 10) / 10,
        });
        return;
      }

      const rect = node.getBoundingClientRect();
      const mouseX = clientX - rect.left;
      const mouseY = clientY - rect.top;

      // 视口几何中心
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      // 鼠标相对于视口中心的偏移向量
      const dx = mouseX - centerX;
      const dy = mouseY - centerY;

      // 定点缩放方程：pan_new = pan_old * ratio + d * (1 - ratio)
      const nextPanX = currPan.x * ratio + dx * (1 - ratio);
      const nextPanY = currPan.y * ratio + dy * (1 - ratio);

      updateZoom(nextZoom);
      updatePan({
        x: Math.round(nextPanX * 10) / 10,
        y: Math.round(nextPanY * 10) / 10,
      });
    },
    [updateZoom, updatePan],
  );

  // 鼠标滚轮和触摸板原生非 passive 监听
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // 结合 Ctrl/Cmd 键或触摸板双指捏合（浏览器原生附带 ctrlKey: true）进行定点缩放
      if (e.ctrlKey || e.metaKey) {
        const delta = -e.deltaY;
        const factor = Math.abs(delta) < 40
          ? 1 + delta * 0.01 // 触摸板小步进平滑缩放
          : delta > 0 ? 1.15 : 0.85; // 鼠标滚轮档位缩放

        zoomAtPoint((curr) => Number((curr * factor).toFixed(3)), e.clientX, e.clientY);
      } else {
        // 普通鼠标滚轮：仅当图片内容尺寸超出视口时，才允许滚动平移对应方向！
        const { imageWidth: curImgW, imageHeight: curImgH, viewportWidth: vpW, viewportHeight: vpH } = sizeRef.current;
        const { canScrollX, canScrollY, maxPanX, maxPanY } = getPanBounds(curImgW, curImgH, vpW, vpH);

        // 图片未超出窗口范围时，保持稳定居中，严禁滚动平移
        if (!canScrollX && !canScrollY) {
          return;
        }

        let moveX = e.deltaX;
        let moveY = e.deltaY;

        // 若横向超出但纵向未超出，且用户滚动垂直滚轮时，自动响应横向平移浏览宽图
        if (canScrollX && !canScrollY && Math.abs(moveY) > 0 && Math.abs(moveX) === 0) {
          moveX = moveY;
          moveY = 0;
        }

        const deltaX = canScrollX ? moveX : 0;
        const deltaY = canScrollY ? moveY : 0;

        if (deltaX === 0 && deltaY === 0) return;

        updatePan((curr) => ({
          x: canScrollX ? Math.min(maxPanX, Math.max(-maxPanX, Math.round((curr.x - deltaX) * 10) / 10)) : 0,
          y: canScrollY ? Math.min(maxPanY, Math.max(-maxPanY, Math.round((curr.y - deltaY) * 10) / 10)) : 0,
        }));
      }
    };

    node.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleNativeWheel);
  }, [zoomAtPoint, updatePan]);

  // 鼠标左键按下开始平移拖拽（仅当内容超出视口时激活拖拽能力）
  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const { canScrollX, canScrollY } = getPanBounds(imageWidth, imageHeight, viewport.width, viewport.height);
    if (!canScrollX && !canScrollY) return;

    event.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      active: true,
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current.active) return;
    event.preventDefault();
    const { canScrollX, canScrollY, maxPanX, maxPanY } = getPanBounds(imageWidth, imageHeight, viewport.width, viewport.height);
    const targetX = dragStartRef.current.panX + (event.clientX - dragStartRef.current.x);
    const targetY = dragStartRef.current.panY + (event.clientY - dragStartRef.current.y);
    updatePan({
      x: canScrollX ? Math.min(maxPanX, Math.max(-maxPanX, targetX)) : 0,
      y: canScrollY ? Math.min(maxPanY, Math.max(-maxPanY, targetY)) : 0,
    });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragStartRef.current.active) {
      dragStartRef.current.active = false;
      setIsDragging(false);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {}
    }
  }

  function handleDoubleClick() {
    updateZoom(1);
    updatePan({ x: 0, y: 0 });
  }

  const { canScrollX, canScrollY } = getPanBounds(imageWidth, imageHeight, viewport.width, viewport.height);
  const canPan = canScrollX || canScrollY;

  return (
    <div
      ref={viewportRef}
      className={cn(
        "relative min-h-0 min-w-0 select-none overflow-hidden touch-none",
        paper ? "bg-white dark:bg-[#202020]" : "bg-slate-50 dark:bg-zinc-900",
        canPan ? (isDragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default",
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      aria-label={alt ? `${alt}，图片查看器` : "图片查看器"}
    >
      <div
        className="flex h-full w-full items-center justify-center p-4"
        style={{
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
          willChange: isDragging ? "transform" : "auto",
        }}
      >
        <img
          src={src}
          alt={alt ?? ""}
          draggable={false}
          className="block max-w-none shrink-0 object-contain pointer-events-none"
          style={{ width: imageWidth, height: imageHeight }}
          onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        />
      </div>
    </div>
  );
}

export function ImageDocumentViewer({ src, alt, path }: { src?: string; alt: string; path?: string }) {
  const label = path || alt;
  return (
    <section className="mk-card flex h-full min-h-[360px] min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-[5px] max-[760px]:min-h-[300px]">
      <header className="flex h-8 shrink-0 min-w-0 items-center gap-1.5 border-b border-slate-200 px-3 text-xs dark:border-zinc-800">
        <ImageIcon className="size-3.5 shrink-0 text-slate-400 dark:text-zinc-500" />
        <span className="truncate font-semibold text-slate-700 dark:text-zinc-200" title={label}>{label}</span>
      </header>
      {src ? <ImageViewer src={src} alt={alt} paper className="h-full flex-1" /> : (
        <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-white text-slate-400 dark:bg-[#202020] dark:text-zinc-500">
          <Loader2 className="size-5 animate-spin" aria-label="正在加载图片" />
        </div>
      )}
    </section>
  );
}

export function MediaPreviewDialog({
  open,
  onOpenChange,
  src,
  alt,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src?: string;
  alt?: string;
  title?: string;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (open) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  }, [open, src]);

  const handleZoomIn = () => {
    setZoom((currZoom) => {
      const nextZoom = clampZoom(Number((currZoom * 1.25).toFixed(3)));
      const ratio = nextZoom / currZoom;
      setPan((currPan) => ({
        x: Math.round(currPan.x * ratio * 10) / 10,
        y: Math.round(currPan.y * ratio * 10) / 10,
      }));
      return nextZoom;
    });
  };

  const handleZoomOut = () => {
    setZoom((currZoom) => {
      const nextZoom = clampZoom(Number((currZoom * 0.8).toFixed(3)));
      const ratio = nextZoom / currZoom;
      setPan((currPan) => ({
        x: Math.round(currPan.x * ratio * 10) / 10,
        y: Math.round(currPan.y * ratio * 10) / 10,
      }));
      return nextZoom;
    });
  };

  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[88vh] w-[88vw] max-w-[1440px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1440px] max-[640px]:h-[92dvh] max-[640px]:w-[calc(100vw-1rem)]"
        aria-describedby={undefined}
      >
        <DialogHeader className="flex shrink-0 flex-row items-center justify-between border-b border-slate-200 px-4 py-2.5 pr-14 dark:border-zinc-800">
          <DialogTitle className="truncate text-sm font-semibold text-slate-800 dark:text-zinc-200">
            {title ?? alt ?? "图片预览"}
          </DialogTitle>
          <DialogDescription className="sr-only">图片预览与缩放拖拽查看</DialogDescription>

          {/* 顶部右侧缩放倍数与手控工具栏 */}
          <div className="flex items-center gap-1 text-slate-600 dark:text-zinc-400">
            <button
              type="button"
              onClick={handleZoomOut}
              className="flex h-7 w-7 items-center justify-center rounded-[4px] transition hover:bg-slate-200/70 hover:text-slate-900 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-100"
              title="缩小 (Ctrl + 滚轮下滑)"
              aria-label="缩小"
            >
              <ZoomOut className="size-3.5" />
            </button>
            <span
              className="min-w-[42px] text-center font-mono text-xs font-semibold text-slate-700 dark:text-zinc-300"
              title="当前放大倍数"
            >
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={handleZoomIn}
              className="flex h-7 w-7 items-center justify-center rounded-[4px] transition hover:bg-slate-200/70 hover:text-slate-900 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-100"
              title="放大 (Ctrl + 滚轮上滑)"
              aria-label="放大"
            >
              <ZoomIn className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-[4px] transition hover:bg-slate-200/70 hover:text-slate-900 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-100"
              title="复位至 100% 居中 (双击画布亦可复位)"
              aria-label="复位尺寸"
            >
              <RotateCcw className="size-3.5" />
            </button>
          </div>
        </DialogHeader>

        {src ? (
          <ImageViewer
            src={src}
            alt={alt}
            className="flex-1"
            zoom={zoom}
            onZoomChange={setZoom}
            pan={pan}
            onPanChange={setPan}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function MediaPreviewDialogHost() {
  const [request, setRequest] = useState<MediaPreviewRequest>();

  useEffect(() => {
    const open = (event: Event) => setRequest((event as CustomEvent<MediaPreviewRequest>).detail);
    window.addEventListener(mediaPreviewRequestEvent, open);
    return () => window.removeEventListener(mediaPreviewRequestEvent, open);
  }, []);

  return <MediaPreviewDialog open={Boolean(request)} onOpenChange={(open) => { if (!open) setRequest(undefined); }} {...request} />;
}
