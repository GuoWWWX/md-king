import { isExternalDocumentLink } from "./document-links.ts";
import { referencePathCandidates, resolveDocumentReference, type ReferenceDocument, type ReferencePreview } from "./document-references.ts";

export async function loadDocumentReference(target: string, context: {
  current: ReferenceDocument;
  openDocuments: ReferenceDocument[];
  availablePaths: string[];
  readFile: (path: string) => Promise<ReferenceDocument>;
}): Promise<ReferencePreview> {
  if (isExternalDocumentLink(target)) throw new Error("仅预览本地文档引用");
  let document: ReferenceDocument | undefined;
  if (target.startsWith("#")) document = context.current;
  else {
    const candidates = referencePathCandidates(target, context.current.path);
    const known = [...context.availablePaths, ...context.openDocuments.map(document => document.path), context.current.path];
    for (const candidate of candidates) {
      const path = known.find(path => path.toLowerCase() === candidate.toLowerCase()) ?? candidate;
      if (path === context.current.path) { document = context.current; break; }
      document = context.openDocuments.find(document => document.path === path);
      if (document) break;
      try { document = await context.readFile(path); break; } catch { /* try the supported extension candidates */ }
    }
  }
  if (!document) throw new Error("未找到引用文档，请检查路径");
  // CodeMirror uses LF internally; selection offsets must use the same text.
  document = { ...document, content: document.content.replace(/\r\n?/g, "\n") };
  const range = resolveDocumentReference(document.content, target);
  if (!range) throw new Error("引用位置不存在或标识重复，请检查章节、段落或行范围");
  return { ...document, range };
}
