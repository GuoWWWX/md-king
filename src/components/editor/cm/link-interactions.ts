import { syntaxTree } from "@codemirror/language";
import { EditorView, type DOMEventHandlers } from "@codemirror/view";

const ADJACENT_LINK_SOURCE_HITBOX_PX = 8;
const LINK_EDGE_SOURCE_HITBOX_PX = 2;

type MarkdownLinkRange = {
  from: number;
  to: number;
  target: string;
};

function clickedLinkTarget(event: MouseEvent): string | undefined {
  if (!(event.target instanceof Element)) return undefined;
  const element = event.target.closest<HTMLElement>("[data-mk-link-target]");
  const target = element?.dataset.mkLinkTarget;
  if (!element || !target) return undefined;

  const rect = element.getBoundingClientRect();
  const inside = event.clientX >= rect.left
    && event.clientX <= rect.right
    && event.clientY >= rect.top
    && event.clientY <= rect.bottom;
  return inside ? target : undefined;
}

function linkAtPosition(view: EditorView, position: number): MarkdownLinkRange | undefined {
  for (const bias of [-1, 1] as const) {
    let node = syntaxTree(view.state).resolveInner(position, bias);
    while (node.parent && node.name !== "Link" && node.name !== "Autolink") node = node.parent;
    if (node.name !== "Link" && node.name !== "Autolink") continue;
    const url = node.getChild("URL");
    const target = url ? view.state.doc.sliceString(url.from, url.to).trim() : "";
    if (target) return { from: node.from, to: node.to, target };
  }
  return undefined;
}

function linksOnLineWithTarget(view: EditorView, position: number, target: string): MarkdownLinkRange[] {
  const line = view.state.doc.lineAt(position);
  const matches: MarkdownLinkRange[] = [];
  syntaxTree(view.state).iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (node.name !== "Link" && node.name !== "Autolink") return undefined;
      const url = node.node.getChild("URL");
      const nodeTarget = url ? view.state.doc.sliceString(url.from, url.to).trim() : "";
      if (nodeTarget !== target) return false;
      matches.push({ from: node.from, to: node.to, target });
      return false;
    },
  });
  return matches;
}

function placePointerInsideHiddenLinkSource(view: EditorView, event: MouseEvent): boolean {
  const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position === null) return false;
  const domLine = event.target instanceof Element ? event.target.closest(".cm-line") : null;
  if (!domLine) return false;
  const renderedElements = Array.from(domLine.querySelectorAll<HTMLElement>("[data-mk-link-target]"));
  const nearbyElement = renderedElements.find((element) => {
    const rect = element.getBoundingClientRect();
    const beside = event.clientX >= rect.left - ADJACENT_LINK_SOURCE_HITBOX_PX
      && event.clientX <= rect.right + ADJACENT_LINK_SOURCE_HITBOX_PX;
    return beside && event.clientY >= rect.top && event.clientY <= rect.bottom;
  });
  const nearbyTarget = nearbyElement?.dataset.mkLinkTarget;
  if (!nearbyTarget) return false;

  const sameTargetElements = renderedElements.filter((element) => element.dataset.mkLinkTarget === nearbyTarget);
  const renderedLinkIndex = Math.floor(sameTargetElements.indexOf(nearbyElement) / 2);
  const link = linkAtPosition(view, position) ?? linksOnLineWithTarget(view, position, nearbyTarget)[renderedLinkIndex];
  if (!link || link.target !== nearbyTarget) return false;
  const renderedParts = sameTargetElements
    .slice(renderedLinkIndex * 2, renderedLinkIndex * 2 + 2)
    .map((element) => element.getBoundingClientRect());
  if (renderedParts.length === 0) return false;

  const left = Math.min(...renderedParts.map((rect) => rect.left));
  const right = Math.max(...renderedParts.map((rect) => rect.right));
  if (event.clientX > left + LINK_EDGE_SOURCE_HITBOX_PX && event.clientX < right - LINK_EDGE_SOURCE_HITBOX_PX) return false;
  const sourcePosition = event.clientX < left ? link.from + 1 : link.to - 1;
  event.preventDefault();
  view.dispatch({ selection: { anchor: sourcePosition } });
  view.focus();
  return true;
}

export type MarkdownLinkInteractionOptions = {
  openLinksOnClick: () => boolean;
  onOpenLink: (target: string) => void;
};

export function markdownLinkInteractionExtension(options: MarkdownLinkInteractionOptions) {
  const handlers: DOMEventHandlers<unknown> = {
    mousedown: (event, view) => {
      if (!options.openLinksOnClick()) return false;
      // 边界命中必须先判断：DOM 的链接矩形包含右边缘，若先按链接本体处理，
      // 光标紧贴链接前后时会被提前拦截，无法展开隐藏的 Markdown 源码。
      if (placePointerInsideHiddenLinkSource(view, event)) return true;
      const target = clickedLinkTarget(event);
      if (target) {
        event.preventDefault();
        return true;
      }
      return false;
    },
    click: (event) => {
      if (!options.openLinksOnClick() && !event.ctrlKey && !event.metaKey) return false;
      const target = clickedLinkTarget(event);
      if (!target) return false;
      event.preventDefault();
      options.onOpenLink(target);
      return true;
    },
  };
  return EditorView.domEventHandlers(handlers);
}
