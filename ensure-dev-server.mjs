import { spawn } from "node:child_process";
import process from "node:process";

const DEV_URL = "http://127.0.0.1:1420";
const MD_KING_MARKER = "md-king";

async function probeDevServer() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(DEV_URL, {
      signal: controller.signal,
      headers: {
        Accept: "text/html",
      },
    });

    if (!response.ok) {
      return "missing";
    }

    const html = await response.text();
    return html.toLowerCase().includes(MD_KING_MARKER) ? "ready" : "occupied";
  } catch {
    return "missing";
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const state = await probeDevServer();

  if (state === "ready") {
    console.log(`[tauri-dev] Reusing existing md-king dev server at ${DEV_URL}`);
    return;
  }

  if (state === "occupied") {
    console.error(`[tauri-dev] Port 1420 is already serving a non-md-king page. Please stop the conflicting service or free the port.`);
    process.exit(1);
  }

  console.log("[tauri-dev] Starting a new Vite dev server on port 1420...");
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(command, ["dev"], {
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error("[tauri-dev] Failed to ensure the dev server:", error);
  process.exit(1);
});
