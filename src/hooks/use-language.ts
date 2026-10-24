import { useEffect, useSyncExternalStore } from "react";
import { getLanguage, normalizeLanguage, setLanguage, subscribeLanguage } from "../lib/i18n.ts";
import { useAppStore } from "../stores/app-store.ts";

export function useLanguage() {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, () => "zh" as const);
  useEffect(() => {
    setLanguage(language);
    const sync = (event: StorageEvent) => {
      if (event.key !== "md-king.language") return;
      const next = normalizeLanguage(event.newValue);
      const store = useAppStore.getState();
      if (store.appConfig && store.appConfig.language !== next) store.setAppConfig({ ...store.appConfig, language: next });
      else setLanguage(next);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [language]);
  return language;
}
