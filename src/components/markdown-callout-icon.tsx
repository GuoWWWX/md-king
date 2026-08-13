import {
  Bug,
  CircleCheck,
  CircleHelp,
  CircleX,
  ClipboardList,
  Info,
  Lightbulb,
  ListTree,
  MessageSquareQuote,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { MarkdownCalloutTone } from "@/lib/markdown-callout";

export function markdownCalloutIcon(type: string, tone: MarkdownCalloutTone): LucideIcon {
  if (type === "abstract" || type === "summary" || type === "tldr") return ClipboardList;
  if (type === "bug") return Bug;
  if (type === "example") return ListTree;
  if (tone === "green") return type === "success" || type === "check" ? CircleCheck : Lightbulb;
  if (tone === "amber") return type === "question" || type === "help" ? CircleHelp : TriangleAlert;
  if (tone === "red") return CircleX;
  if (tone === "slate") return MessageSquareQuote;
  return Info;
}

export function MarkdownCalloutIcon({ type, tone, className }: { type: string; tone: MarkdownCalloutTone; className?: string }) {
  const Icon = markdownCalloutIcon(type, tone);
  return <Icon className={className} aria-hidden="true" />;
}
