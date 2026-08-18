import type { AccentColor, ThemeMode } from "@/types";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const APPEARANCE_STORAGE_KEY = "md-king-appearance";

function syncNativeWindowBackground(isDark: boolean) {
  if (document.documentElement.dataset.floatingWindow === "true") return;
  const tauriWindow = window as Window & { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  if (!tauriWindow.__TAURI_INTERNALS__ && !tauriWindow.__TAURI__) return;
  try {
    const currentWindow = getCurrentWindow();
    void currentWindow.setBackgroundColor(isDark ? "#2e2e2e" : "#f4f6f8").catch(() => {
      // 原生窗口不可用时，页面主题仍然正常生效。
    });
    void currentWindow.setShadow(false).catch(() => {
      // 当前平台不支持窗口阴影设置时，页面主题仍然正常生效。
    });
  } catch {
    // 浏览器开发环境没有原生窗口，页面主题仍然正常生效。
  }
}

export const accentThemes: Record<AccentColor, { primary: string; hover: string; ring: string; accent: string; accentForeground: string; muted: string; backgroundGlow: string }> = {
  indigo: { primary: "#4f46e5", hover: "#4338ca", ring: "#4f46e5", accent: "#eef2ff", accentForeground: "#312e81", muted: "#eef2ff", backgroundGlow: "rgba(79, 70, 229, 0.12)" },
  blue: { primary: "#2563eb", hover: "#1d4ed8", ring: "#2563eb", accent: "#dbeafe", accentForeground: "#1e3a8a", muted: "#eff6ff", backgroundGlow: "rgba(37, 99, 235, 0.12)" },
  emerald: { primary: "#059669", hover: "#047857", ring: "#059669", accent: "#d1fae5", accentForeground: "#064e3b", muted: "#ecfdf5", backgroundGlow: "rgba(5, 150, 105, 0.12)" },
  sky: { primary: "#0284c7", hover: "#0369a1", ring: "#0284c7", accent: "#e0f2fe", accentForeground: "#075985", muted: "#f0f9ff", backgroundGlow: "rgba(2, 132, 199, 0.12)" },
  slate: { primary: "#334155", hover: "#1e293b", ring: "#475569", accent: "#f1f5f9", accentForeground: "#0f172a", muted: "#f8fafc", backgroundGlow: "rgba(51, 65, 85, 0.1)" },
  rose: { primary: "#e11d48", hover: "#be123c", ring: "#e11d48", accent: "#ffe4e6", accentForeground: "#881337", muted: "#fff1f2", backgroundGlow: "rgba(225, 29, 72, 0.1)" },
  amber: { primary: "#d97706", hover: "#b45309", ring: "#d97706", accent: "#fef3c7", accentForeground: "#78350f", muted: "#fffbeb", backgroundGlow: "rgba(217, 119, 6, 0.1)" },
};

export function applyAppearance(themeMode: ThemeMode, accentColor: AccentColor) {
  const root = document.documentElement;
  const theme = accentThemes[accentColor] ?? accentThemes.blue;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = themeMode === "dark" || (themeMode === "system" && prefersDark);

  root.classList.toggle("dark", isDark);
  root.dataset.accentColor = accentColor;
  root.dataset.bootTheme = isDark ? "dark" : "light";
  root.style.colorScheme = isDark ? "dark" : "light";
  root.style.setProperty("--primary", theme.primary);
  root.style.setProperty("--ring", theme.ring);
  root.style.setProperty("--chart-1", theme.primary);
  root.style.setProperty("--sidebar-primary", theme.primary);
  root.style.setProperty("--sidebar-ring", theme.ring);
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--sidebar-accent", theme.accent);
  root.style.setProperty("--muted", theme.muted);
  root.style.setProperty("--accent-foreground", theme.accentForeground);
  root.style.setProperty("--sidebar-accent-foreground", theme.accentForeground);
  root.style.setProperty("--app-primary", theme.primary);
  root.style.setProperty("--app-primary-hover", theme.hover);
  root.style.setProperty("--app-primary-soft", isDark ? `color-mix(in srgb, ${theme.primary} 20%, #111827)` : theme.accent);
  root.style.setProperty("--app-primary-text", isDark ? `color-mix(in srgb, ${theme.primary} 55%, white)` : theme.accentForeground);
  root.style.setProperty("--app-accent-glow", isDark ? `color-mix(in srgb, ${theme.primary} 22%, transparent)` : theme.backgroundGlow);
  root.style.setProperty("--mk-blue", theme.primary);
  root.style.setProperty("--mk-blue-deep", theme.hover);
  root.style.setProperty("--mk-blue-soft", isDark ? `color-mix(in srgb, ${theme.primary} 22%, #111827)` : theme.accent);
  root.style.setProperty("--mk-blue-faint", isDark ? `color-mix(in srgb, ${theme.primary} 12%, #0f172a)` : theme.muted);
  root.style.setProperty("--mk-blue-border", isDark ? `color-mix(in srgb, ${theme.primary} 28%, transparent)` : `color-mix(in srgb, ${theme.primary} 28%, white)`);
  syncNativeWindowBackground(isDark);

  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ themeMode, accentColor }));
  } catch {
    // Local storage can be unavailable in restricted webviews; visual theme still applies.
  }
}
