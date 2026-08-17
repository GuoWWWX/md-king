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
  displayFrom: number;
  displayTo: number;
};

type ClickedLink = {
  target: string;
  element: HTMLElement;
};

type PendingWikilinkPointer = {
  target: string;
  canOpen: boolean;
  anchor: number;
  displayFrom: number;
  displayTo: number;
  left: number;
  right: number;
  startX: number;
  startY: number;
  dragging: boolean;
};

function clickedLink(event: MouseEvent): ClickedLink | undefined {
  if (!(event.target instanceof Element)) return undefined;
  const element = event.target.closest<HTMLElement>("[data-mk-link-target]");
  const target = element?.dataset.mkLinkTarget;
  if (!element || !target) return undefined;

  const rect = element.getBoundingClientRect();
  const inside = event.clientX >= rect.left
    && event.clientX <= rect.right
    && event.clientY >= rect.top
    && event.clientY <= rect.bottom;
  return inside ? { target, element } : undefined;
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
    ? {
      ...link,
      displayFrom: line.from + match.displayFrom,
      displayTo: line.from + match.displayTo,
    }
    : undefined;
}

function wikilinkRangeAtSourcePosition(view: EditorView, from: number, target: string): WikilinkRange | undefined {
  if (from < 0 || from >= view.state.doc.length) return undefined;
  const line = view.state.doc.lineAt(from);
  const match = findObsidianWikilinks(line.text).find((wikilink) => (
    line.from + wikilink.from === from && wikilink.target === target
  ));
  return match
    ? {
      from,
      to: line.from + match.to,
      target,
      displayFrom: line.from + match.displayFrom,
      displayTo: line.from + match.displayTo,
    }
    : undefined;
}

function wikilinkRangeFromRenderedElement(
  view: EditorView,
  element: HTMLElement,
  target: string,
): WikilinkRange | undefined {
  if (!element.classList.contains("mk-cm-link--wikilink")) return undefined;
  const from = element.dataset.mkWikilinkFrom;
  return from === undefined ? undefined : wikilinkRangeAtSourcePosition(view, Number(from), target);
}

function displayPositionAtPointer(
  wikilink: Pick<PendingWikilinkPointer, "displayFrom" | "displayTo" | "left" | "right">,
  clientX: number,
): number {
  const width = Math.max(1, wikilink.right - wikilink.left);
  const ratio = Math.max(0, Math.min(1, (clientX - wikilink.left) / width));
  return wikilink.displayFrom + Math.round((wikilink.displayTo - wikilink.displayFrom) * ratio);
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
  if (nearbyElement.classList.contains("mk-cm-link--wikilink")) {
    const link = wikilinkRangeFromRenderedElement(view, nearbyElement, nearbyTarget);
    if (!link) return false;
    const rect = nearbyElement.getBoundingClientRect();
    if (event.clientX >= rect.left && event.clientX <= rect.right) return false;

    // 链接本体保持可点击跳转；只有左右紧邻区域作为源码编辑入口。
    // 直接落到真实源码边界，避免先替换 DOM 再依赖 posAtCoords 导致光标掉到下一行。
    const sourcePosition = event.clientX < rect.left ? link.from : link.to;
    event.preventDefault();
    view.dispatch({ selection: { anchor: sourcePosition } });
    view.focus();
    return true;
  }

  const sameTargetElements = renderedElements.filter((element) => element.dataset.mkLinkTarget === nearbyTarget);

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

  if (wikilinkRange(view, link)) return false;

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
  let pendingLinkTarget: string | undefined;
  let pendingWikilinkPointer: PendingWikilinkPointer | undefined;
  let swallowNextClick = false;

  const handlers: DOMEventHandlers<unknown> = {
    mousedown: (event, view) => {
      pendingLinkTarget = undefined;
      pendingWikilinkPointer = undefined;
      swallowNextClick = false;
      if (event.button !== 0) return false;

      const clicked = clickedLink(event);
      if (!clicked && placePointerInsideHiddenLinkSource(view, event)) return true;
      if (!options.openLinksOnClick()) return false;
      if (clicked) {
        const wikilink = wikilinkRangeFromRenderedElement(view, clicked.element, clicked.target);
        if (wikilink) {
          const rect = clicked.element.getBoundingClientRect();
          const pointer: PendingWikilinkPointer = {
            target: clicked.target,
            canOpen: clicked.element.dataset.mkWikilinkInvalid !== "true",
            displayFrom: wikilink.displayFrom,
            displayTo: wikilink.displayTo,
            left: rect.left,
            right: rect.right,
            startX: event.clientX,
            startY: event.clientY,
            anchor: 0,
            dragging: false,
          };
          pointer.anchor = displayPositionAtPointer(pointer, event.clientX);
          pendingWikilinkPointer = pointer;
          event.preventDefault();
          view.focus();
          return true;
        }

        // 普通 Markdown 链接仍交给编辑器创建选区；鼠标松开时再按空选区决定是否打开。
        pendingLinkTarget = clicked.target;
        return false;
      }

      return false;
    },
    mousemove: (event, view) => {
      const pointer = pendingWikilinkPointer;
      if (!pointer) return false;
      if (!pointer.dragging) {
        const distance = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY);
        if (distance < 4) return false;
        pointer.dragging = true;
      }

      const head = displayPositionAtPointer(pointer, event.clientX);
      view.dispatch({
        selection: {
          anchor: pointer.anchor,
          head: head === pointer.anchor ? Math.min(pointer.displayTo, pointer.anchor + 1) : head,
        },
      });
      view.focus();
      event.preventDefault();
      return true;
    },
    mouseup: (event, view) => {
      const wikilinkPointer = pendingWikilinkPointer;
      pendingWikilinkPointer = undefined;
      if (wikilinkPointer) {
        if (event.button !== 0 || !options.openLinksOnClick()) return false;
        event.preventDefault();
        swallowNextClick = true;
        if (!wikilinkPointer.dragging && wikilinkPointer.canOpen) options.onOpenLink(wikilinkPointer.target);
        return true;
      }

      const target = pendingLinkTarget;
      pendingLinkTarget = undefined;
      if (!target || event.button !== 0 || !options.openLinksOnClick()) return false;
      if (view.state.selection.ranges.some((range) => !range.empty)) return false;

      event.preventDefault();
      swallowNextClick = true;
      options.onOpenLink(target);
      return true;
    },
    click: (event, view) => {
      if (swallowNextClick) {
        swallowNextClick = false;
        event.preventDefault();
        return true;
      }
      if (!options.openLinksOnClick() && !event.ctrlKey && !event.metaKey) return false;
      if (view.state.selection.ranges.some((range) => !range.empty)) return false;
      const clicked = clickedLink(event);
      if (!clicked) return false;
      event.preventDefault();
      options.onOpenLink(clicked.target);
      return true;
    },
  };
  return EditorView.domEventHandlers(handlers);
}
