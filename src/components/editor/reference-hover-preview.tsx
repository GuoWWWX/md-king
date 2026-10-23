import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight } from "lucide-react";
import { LiveMarkdownEditor } from "./live-markdown-editor";
import { isExternalDocumentLink } from "@/lib/document-links";
import { referenceLineLabel, stripReferenceMetadata, type ReferencePreview } from "@/lib/document-references";

export function ReferenceHoverPreview({ load, onOpen, revision, isDark }: {
  load: (target: string) => Promise<ReferencePreview>;
  onOpen: (target: string) => void;
  revision: string;
  isDark: boolean;
}) {
  const callbacks = useRef({ load, onOpen, revision });
  callbacks.current = { load, onOpen, revision };
  const [preview, setPreview] = useState<{ target: string; value?: ReferencePreview; error?: string }>();
  const popup = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLElement | undefined>(undefined);
  const sequence = useRef(0);

  useEffect(() => {
    let openTimer: number | undefined, closeTimer: number | undefined;
    let pending: HTMLElement | undefined;
    const cancelOpen = () => { window.clearTimeout(openTimer); pending = undefined; };
    const keep = () => { cancelOpen(); window.clearTimeout(closeTimer); };
    const close = () => { keep(); active.current = undefined; sequence.current++; setPreview(undefined); };
    const enter = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (popup.current?.contains(event.target)) { keep(); return; }
      const element = event.target.closest<HTMLElement>("[data-mk-link-target],a[href]");
      if (!element || !element.closest(".mk-cm-host,.mk-preview-panel,[data-reference-scope]")) return;
      const target = element.dataset.mkLinkTarget ?? element.getAttribute("href") ?? "";
      if (!target || isExternalDocumentLink(target) || element.dataset.mkWikilinkInvalid) return;
      if (active.current === element) { keep(); return; }
      if (pending === element) return;
      cancelOpen(); pending = element;
      // Keep the current card visible while passing over neighbouring links.
      openTimer = window.setTimeout(async () => {
        if (pending !== element || !element.isConnected) return;
        pending = undefined; window.clearTimeout(closeTimer); active.current = element;
        // Use the current revision when loading, including edits flushed during the hover delay.
        const request = ++sequence.current, version = callbacks.current.revision;
        setPreview({ target });
        try {
          const value = await callbacks.current.load(target);
          if (request === sequence.current && version === callbacks.current.revision && element.isConnected) setPreview({ target, value });
        } catch (error) {
          if (request === sequence.current && version === callbacks.current.revision) setPreview({ target, error: error instanceof Error ? error.message : "无法预览引用" });
        }
      }, 400);
    };
    const leave = (event: PointerEvent) => {
      const related = event.relatedTarget;
      if (related instanceof Node && (active.current?.contains(related) || popup.current?.contains(related))) { keep(); return; }
      if (event.target instanceof Node && pending?.contains(event.target) && !(related instanceof Node && pending.contains(related))) cancelOpen();
      if (event.target instanceof Node && (active.current?.contains(event.target) || popup.current?.contains(event.target))) {
        window.clearTimeout(closeTimer);
        closeTimer = window.setTimeout(close, 500);
      }
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) close(); };
    document.addEventListener("pointerover", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", scroll, true);
    return () => {
      close();
      document.removeEventListener("pointerover", enter);
      document.removeEventListener("pointerout", leave); document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", scroll, true);
    };
  }, []);

  useLayoutEffect(() => {
    const element = popup.current, trigger = active.current;
    if (!preview || !element || !trigger) return;
    const position = () => {
      if (!trigger.isConnected) return;
      const anchor = trigger.getBoundingClientRect();
      const headerHeight = element.firstElementChild?.getBoundingClientRect().height ?? 0;
      const scroller = element.querySelector<HTMLElement>(".cm-scroller");
      const bodyHeight = scroller ? Math.min(300, scroller.scrollHeight) : element.lastElementChild?.scrollHeight ?? 0;
      const height = Math.min(350, headerHeight + bodyHeight + 2);
      const below = Math.max(0, window.innerHeight - anchor.bottom - 14);
      const above = Math.max(0, anchor.top - 14);
      const opensAbove = height > below && above > below;
      const available = opensAbove ? above : below;
      element.style.maxHeight = `${Math.min(350, available)}px`;
      element.style.setProperty("--reference-preview-body-height", `${Math.max(0, available - headerHeight - 2)}px`);
      const bounds = element.getBoundingClientRect();
      element.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8))}px`;
      element.style.top = `${Math.max(8, opensAbove ? anchor.top - 6 - bounds.height : anchor.bottom + 6)}px`;
    };
    position();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    });
    observer.observe(element);
    const content = element.querySelector(".cm-content");
    if (content) observer.observe(content);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [preview]);

  useEffect(() => {
    sequence.current++;
    if (!active.current?.isConnected) active.current = undefined;
    setPreview(undefined);
  }, [revision]);

  useEffect(() => {
    let cancelled = false, frame = 0;
    const seen = new WeakMap<Element, string>();
    const scan = () => {
      frame = 0;
      for (const element of document.querySelectorAll<HTMLElement>("[data-mk-auto-line]")) {
        if (element.closest("[data-reference-preview]")) continue;
        const target = element.dataset.mkLinkTarget ?? element.getAttribute("href");
        if (!target || seen.get(element) === target) continue;
        seen.set(element, target);
        const label = element.querySelector("[data-mk-reference-label]");
        if (!label) continue;
        void callbacks.current.load(target).then(value => {
          if (!cancelled && element.isConnected) label.textContent = referenceLineLabel(value.range);
        }).catch(() => { if (!cancelled && element.isConnected) label.textContent = "引用已失效"; });
      }
    };
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(scan); });
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
    return () => { cancelled = true; observer.disconnect(); cancelAnimationFrame(frame); };
  }, [revision]);

  if (!preview) return null;
  const value = preview.value;
  const snippet = value ? stripReferenceMetadata(value.content.slice(value.range.from, value.range.to)).split("\n").slice(0, 30).join("\n") : "";
  return createPortal(
    <div ref={popup} data-reference-preview role="dialog" aria-label="引用内容预览" className="fixed z-[100] flex max-h-[350px] w-[460px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2 text-xs dark:border-zinc-700">
        <span className="truncate font-medium">{value?.path.split("/").pop() || "当前文档"}</span>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-muted-foreground">{value ? referenceLineLabel(value.range) : preview.error ? "无法预览" : "加载中…"}</span>
          <button type="button" aria-label="跳转并选中引用内容" data-tooltip="跳转并选中引用内容" disabled={!value} className="flex size-6 items-center justify-center rounded text-blue-600 hover:bg-slate-100 disabled:opacity-40 dark:text-blue-400 dark:hover:bg-zinc-800" onClick={() => { callbacks.current.onOpen(preview.target); setPreview(undefined); }}><ArrowUpRight className="size-4" /></button>
        </div>
      </div>
      {value ? <div className="min-h-0"><LiveMarkdownEditor documentKey={`${preview.target}:${revision}`} initialContent={snippet} markdownSourcePath={value.absolutePath} readOnly isDark={isDark} onDocChanged={() => {}} /></div>
        : <p className="px-3 py-4 text-sm text-muted-foreground">{preview.error ?? "正在读取引用内容…"}</p>}
    </div>, document.body,
  );
}
