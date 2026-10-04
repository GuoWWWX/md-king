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

  // 仅在 src 切换时重置视图
  useEffect(() => {
    updateZoom(1);
    updatePan({ x: 0, y: 0 });
    setNaturalSize(undefined);
  }, [src, updateZoom, updatePan]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;
    const update = () => setViewport({ width: node.clientWidth, height: node.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // 鼠标滚轮和触摸板双指捏合（pinch）原生非 passive 监听，防止父级页面跟着滚动
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY < 0 ? 1.15 : 0.85;
      updateZoom((curr) => Number((curr * factor).toFixed(3)));
    };

    node.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleNativeWheel);
  }, [updateZoom]);

  // 鼠标左键按下开始平移拖拽
  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
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
    const dx = event.clientX - dragStartRef.current.x;
    const dy = event.clientY - dragStartRef.current.y;
    updatePan({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
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

  const fitScale = naturalSize && viewport.width > 0 && viewport.height > 0
    ? Math.min(Math.max(1, viewport.width - 48) / naturalSize.width, Math.max(1, viewport.height - 48) / naturalSize.height)
    : 1;
  const imageWidth = naturalSize ? Math.max(1, naturalSize.width * fitScale * zoom) : undefined;
  const imageHeight = naturalSize ? Math.max(1, naturalSize.height * fitScale * zoom) : undefined;

  return (
    <div
      ref={viewportRef}
      className={cn(
        "relative min-h-0 min-w-0 select-none overflow-hidden touch-none",
        paper ? "bg-white dark:bg-[#202020]" : "bg-slate-50 dark:bg-zinc-900",
        isDragging ? "cursor-grabbing" : "cursor-grab",
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
        className="flex h-full w-full items-center justify-center p-4 transition-transform ease-out"
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

  const handleZoomIn = () => setZoom((z) => clampZoom(Number((z * 1.25).toFixed(3))));
  const handleZoomOut = () => setZoom((z) => clampZoom(Number((z * 0.8).toFixed(3))));
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
              title="缩小 (滚轮下滑)"
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
              title="放大 (滚轮上滑)"
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
