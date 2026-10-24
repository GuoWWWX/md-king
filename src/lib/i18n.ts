import english from "../locales/en.json" with { type: "json" };

export type Language = "zh" | "en";
const messages: Readonly<Record<string, string>> = english;
const listeners = new Set<() => void>();
const storageKey = "md-king.language";

export function normalizeLanguage(value: unknown): Language {
  return value === "en" ? "en" : "zh";
}

function readLanguage(): Language {
  try { return normalizeLanguage(globalThis.localStorage?.getItem(storageKey)); }
  catch { return "zh"; }
}

let language = readLanguage();

export function getLanguage(): Language { return language; }

export function setLanguage(value: unknown) {
  const next = normalizeLanguage(value);
  try { globalThis.localStorage?.setItem(storageKey, next); } catch { /* Native config remains authoritative. */ }
  if (typeof document !== "undefined") document.documentElement.lang = next === "en" ? "en" : "zh-CN";
  if (language === next) return;
  language = next;
  for (const listener of listeners) listener();
}

export function subscribeLanguage(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Translate application messages only. Never pass document contents or user names. */
export function translate(key: string, locale: Language, values: readonly unknown[] = []): string {
  const message = locale === "en" ? messages[key] ?? key : key;
  return message.replace(/\{(\d+)\}/g, (placeholder, index: string) =>
    Number(index) < values.length ? String(values[Number(index)] ?? "") : placeholder);
}

export function t(key: string | undefined, values?: readonly unknown[]) {
  return key === undefined ? "" : translate(key, language, values);
}
