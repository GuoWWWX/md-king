import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type WheelEvent } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const minZoom = 0.25;
const maxZoom = 4;
const mediaPreviewRequestEvent = "md-king:open-media-preview";

type MediaPreviewRequest = {
  src: string;
  alt?: string;
  title?: string;
};

function clampZoom(value: number) {
  return Math.min(maxZoom, Math.max(minZoom, value));
}

export function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function requestMediaPreview(request: MediaPreviewRequest) {
  window.dispatchEvent(new CustomEvent<MediaPreviewRequest>(mediaPreviewRequestEvent, { detail: request }));
}

export function ImageViewer({ src, alt, className }: { src: string; alt?: string; className?: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>();

  useEffect(() => {
    setZoom(1);
    setNaturalSize(undefined);
  }, [src]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;
    const update = () => setViewport({ width: node.clientWidth, height: node.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setZoom((current) => clampZoom(Number((current * (event.deltaY < 0 ? 1.1 : 0.9)).toFixed(3))));
  }

  const fitScale = naturalSize && viewport.width > 0 && viewport.height > 0
    ? Math.min(1, Math.max(1, viewport.width - 32) / naturalSize.width, Math.max(1, viewport.height - 32) / naturalSize.height)
    : 1;
  const imageWidth = naturalSize ? Math.max(1, naturalSize.width * fitScale * zoom) : undefined;
  const imageHeight = naturalSize ? Math.max(1, naturalSize.height * fitScale * zoom) : undefined;
  const canvasWidth = Math.max(viewport.width, (imageWidth ?? 0) + 32);
  const canvasHeight = Math.max(viewport.height, (imageHeight ?? 0) + 32);
  // 适配尺寸下出现滚动条会反过来挤压 clientWidth/clientHeight，触发尺寸重算并闪烁。
  // 仅在用户放大图片后开放双轴滚动。
  const allowPan = zoom > 1;

  return (
    <div
      ref={viewportRef}
      className={cn("min-h-0 min-w-0 bg-slate-50 dark:bg-zinc-900", allowPan ? "overflow-auto" : "overflow-hidden", className)}
      onWheel={handleWheel}
      aria-label={alt ? `${alt}，图片查看器` : "图片查看器"}
    >
      <div
        className="box-border flex items-center justify-center p-4"
        style={{ minWidth: "100%", minHeight: "100%", width: canvasWidth || undefined, height: canvasHeight || undefined }}
      >
        <img
          src={src}
          alt={alt ?? ""}
          className="block max-w-none shrink-0 object-contain"
          style={{ width: imageWidth, height: imageHeight }}
          onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        />
      </div>
    </div>
  );
}

export function ImageDocumentViewer({ src, alt }: { src?: string; alt: string }) {
  return (
    <section className="mk-card flex h-full min-h-[360px] min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-[5px] max-[760px]:min-h-[300px]">
      {src ? <ImageViewer src={src} alt={alt} className="h-full flex-1" /> : (
        <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-slate-50 text-slate-400 dark:bg-zinc-900 dark:text-zinc-500">
          <Loader2 className="size-5 animate-spin" aria-label="正在加载图片" />
        </div>
      )}
    </section>
  );
}

export function MediaPreviewDialog({ open, onOpenChange, src, alt, title }: { open: boolean; onOpenChange: (open: boolean) => void; src?: string; alt?: string; title?: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-[82vw] max-w-[1440px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1440px] max-[640px]:h-[90dvh] max-[640px]:w-[calc(100vw-1.5rem)]" aria-describedby={undefined}>
        <DialogHeader className="shrink-0 border-b border-slate-200 px-4 py-3 pr-12 dark:border-zinc-800">
          <DialogTitle className="truncate text-sm font-semibold">{title ?? alt ?? "图片预览"}</DialogTitle>
          <DialogDescription className="sr-only">图片预览</DialogDescription>
        </DialogHeader>
        {src ? <ImageViewer src={src} alt={alt} className="flex-1" /> : null}
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
