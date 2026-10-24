const labels = new WeakMap<HTMLElement, Map<string, () => string>>();

/** CodeMirror owns these DOM controls outside React; keep their labels live too. */
export function setControlLabel(element: HTMLElement, attribute: string, render: () => string) {
  const attributes = labels.get(element) ?? new Map<string, () => string>();
  attributes.set(attribute, render);
  labels.set(element, attributes);
  element.dataset.mkLocalizedControl = "true";
  if (attribute === "textContent") element.textContent = render();
  else element.setAttribute(attribute, render());
}

export function refreshControlLabels(root: HTMLElement) {
  for (const element of root.querySelectorAll<HTMLElement>("[data-mk-localized-control]")) {
    for (const [attribute, render] of labels.get(element) ?? []) {
      if (attribute === "textContent") element.textContent = render();
      else element.setAttribute(attribute, render());
    }
  }
}
