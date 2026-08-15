import { syntaxTree } from "@codemirror/language";
import { EditorView, type DOMEventHandlers } from "@codemirror/view";
import { findObsidianWikilinks } from "@/lib/document-links";

const ADJACENT_LINK_SOURCE_HITBOX_PX = 8;
const LINK_EDGE_SOURCE_HITBOX_PX = 2;

type MarkdownLinkRange = {
  from: number;
  to: number;
  target: string;
};

type WikilinkRange = MarkdownLinkRange & {
  sourcePosition: number;
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
  const line = view.state.doc.lineAt(position);
  const wikilink = findObsidianWikilinks(line.text).find((match) => {
    const from = line.from + match.from;
    const to = line.from + match.to;
    return position >= from && position <= to;
  });
  if (wikilink) return { from: line.from + wikilink.from, to: line.from + wikilink.to, target: wikilink.target };
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
  for (const wikilink of findObsidianWikilinks(line.text)) {
    if (wikilink.target !== target) continue;
    matches.push({ from: line.from + wikilink.from, to: line.from + wikilink.to, target });
  }
  return matches;
}

function wikilinkRange(view: EditorView, link: MarkdownLinkRange): WikilinkRange | undefined {
  const line = view.state.doc.lineAt(link.from);
  const match = findObsidianWikilinks(line.text).find((wikilink) => (
    line.from + wikilink.from === link.from
    && line.from + wikilink.to === link.to
    && wikilink.target === link.target
  ));
  return match
    ? { ...link, sourcePosition: line.from + match.displayFrom }
    : undefined;
}

function wikilinkRangeAtSourcePosition(view: EditorView, from: number, target: string): WikilinkRange | undefined {
  if (from < 0 || from >= view.state.doc.length) return undefined;
  const line = view.state.doc.lineAt(from);
  const match = findObsidianWikilinks(line.text).find((wikilink) => (
    line.from + wikilink.from === from && wikilink.target === target
  ));
  return match
    ? { from, to: line.from + match.to, target, sourcePosition: line.from + match.displayFrom }
    : undefined;
}

function placePointerInsideHiddenLinkSource(view: EditorView, event: MouseEvent): boolean {
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
  const markedWikilinkFrom = sameTargetElements
    .map((element) => element.dataset.mkWikilinkFrom)
    .find((value): value is string => value !== undefined);
  if (markedWikilinkFrom !== undefined) {
    const wikilink = wikilinkRangeAtSourcePosition(view, Number(markedWikilinkFrom), nearbyTarget);
    if (wikilink) {
      event.preventDefault();
      view.dispatch({ selection: { anchor: wikilink.sourcePosition } });
      view.focus();
      return true;
    }
  }

  // 图标和文字之间的空隙没有可靠的文档坐标；双链已经用源码起点处理完。
  // 普通 Markdown 链接仍需要坐标反查语法节点，因此放到这里再读取即可。
  const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position === null) return false;
  const renderedLinkIndex = Math.floor(sameTargetElements.indexOf(nearbyElement) / 2);
  const link = linkAtPosition(view, position) ?? linksOnLineWithTarget(view, position, nearbyTarget)[renderedLinkIndex];
  if (!link || link.target !== nearbyTarget) return false;
  const renderedParts = sameTargetElements
    .slice(renderedLinkIndex * 2, renderedLinkIndex * 2 + 2)
    .map((element) => element.getBoundingClientRect());
  if (renderedParts.length === 0) return false;

  // 双链属于 Markdown 的编辑对象。点击它的图标、显示名及两侧紧邻位置时，
  // 先展开 `[[...]]` 源码并把光标放到显示文字处，不能按普通超链接跳转。
  const wikilink = wikilinkRange(view, link);
  if (wikilink) {
    event.preventDefault();
    view.dispatch({ selection: { anchor: wikilink.sourcePosition } });
    view.focus();
    return true;
  }

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
