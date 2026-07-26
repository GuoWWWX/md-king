import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;
const dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("lucide-react")) return "icons";
          // language-data 会带进十几个 lang-* 包，单独分出去，
          // 否则主 chunk 会被一堆用不到的语言语法撑大。
          // 括号是必需的：|| 和 && 混写时优先级会让最后一个条件独立成真。
          const isCoreLezer = id.includes("@lezer/common") || id.includes("@lezer/highlight") || id.includes("@lezer/markdown");
          if (id.includes("@codemirror/language-data") || id.includes("@codemirror/lang-") || (id.includes("@lezer/") && !isCoreLezer)) {
            return "cm-languages";
          }
          if (id.includes("@codemirror") || id.includes("@lezer")) return "codemirror";
          if (id.includes("react") || id.includes("react-dom")) return "react";
          if (id.includes("radix-ui")) return "radix";
          if (id.includes("markdown-it")) return "markdown";
          if (id.includes("@tauri-apps")) return "tauri";
          return "vendor";
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
