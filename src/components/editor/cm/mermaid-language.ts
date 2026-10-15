import { LanguageDescription, LanguageSupport, StreamLanguage, type StringStream } from "@codemirror/language";

const keywords = new Set(`
  flowchart graph flowchart-elk sequenceDiagram classDiagram classDiagram-v2
  stateDiagram stateDiagram-v2 erDiagram mindmap gantt pie journey gitGraph
  timeline quadrantChart xychart xychart-beta requirementDiagram block-beta
  packet-beta architecture-beta kanban sankey sankey-beta radar-beta treemap-beta
  C4Context C4Container C4Component C4Dynamic C4Deployment info
  subgraph end direction TB TD BT LR RL classDef class style linkStyle click
  participant actor activate deactivate autonumber note Note over of left right
  loop alt else opt par and critical option break rect title section
  state note as fork join choice concurrent description accTitle accDescr
  dateFormat axisFormat excludes includes todayMarker tickInterval
  commit branch checkout switch merge cherry-pick reset tag
  x-axis y-axis quadrant-1 quadrant-2 quadrant-3 quadrant-4
  requirement element id text risk verifymethod type satisfies verifies traces
  columns space service group junction axis curve showData
  fill stroke stroke-width color opacity font-size font-weight
  true false null
`.trim().split(/\s+/));

type MermaidState = { quote: string | null };

function quotedText(stream: StringStream, state: MermaidState) {
  let escaped = false;
  while (!stream.eol()) {
    const char = stream.next();
    if (!escaped && char === state.quote) {
      state.quote = null;
      break;
    }
    escaped = !escaped && char === "\\";
  }
  return "string";
}

// Only tokenize for display. Mermaid itself remains responsible for syntax validation.
export const mermaidLanguage = StreamLanguage.define<MermaidState>({
  name: "mermaid",
  startState: () => ({ quote: null }),
  token(stream, state) {
    if (state.quote) return quotedText(stream, state);
    if (stream.eatSpace()) return null;
    if (stream.match("%%")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match(/["'`]/)) {
      state.quote = stream.current();
      return quotedText(stream, state);
    }
    if (stream.match(/\[[^\]\r\n]*\]|\([^\)\r\n]*\)|\{[^\}\r\n]*\}/)) return "string";
    if (stream.match(/#[\da-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|%)?/)) return "number";
    if (stream.match(/[-=<>.~]+|[{}\[\]():,;|+*/]/)) return "operator";
    if (stream.match(/[\p{L}_$][\p{L}\p{N}_$]*(?:-[\p{L}\p{N}_$]+)*/u)) {
      return keywords.has(stream.current()) ? "keyword" : "typeName";
    }
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "%%" } },
});

export const mermaidLanguageDescription = LanguageDescription.of({
  name: "Mermaid",
  support: new LanguageSupport(mermaidLanguage),
});
