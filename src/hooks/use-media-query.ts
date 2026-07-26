import { useSyncExternalStore } from "react";

/// 用 useSyncExternalStore 而不是 useState + useEffect：后者在首次渲染时会先给出错误的
/// 默认值再纠正，转换页据此决定「渲染几份 Word 预览」，闪一下就是白跑一遍 1700 行解析管线。
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
      const mediaQuery = window.matchMedia(query);
      mediaQuery.addEventListener("change", onChange);
      return () => mediaQuery.removeEventListener("change", onChange);
    },
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}
