import { type ChildProcess, spawn } from "node:child_process";
import { watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const desktopRoot = resolve(__dirname, "..");
const srcDir = resolve(desktopRoot, "src");

let electronProcess: ChildProcess | null = null;
let isRebuilding = false;
let rebuildPending = false;
let debounceTimer: Timer | null = null;

async function runBuild(): Promise<boolean> {
  return new Promise((resolve) => {
    const buildProc = spawn("bun", ["run", "./build/build.ts"], {
      cwd: desktopRoot,
      stdio: "inherit",
      shell: true,
    });

    buildProc.on("exit", (code) => {
      resolve(code === 0);
    });
  });
}

function startElectron(): void {
  if (electronProcess) {
    try {
      electronProcess.kill();
    } catch {
      // Ignore process kill errors
    }
    electronProcess = null;
  }

  console.log("\n[desktop:dev] Starting Electron...");
  electronProcess = spawn("npx", ["electron", "."], {
    cwd: desktopRoot,
    stdio: "inherit",
    shell: true,
  });

  electronProcess.on("exit", (code) => {
    if (code !== null && code !== 0 && code !== 130) {
      console.log(`[desktop:dev] Electron exited with code ${code}`);
    }
  });
}

async function rebuildAndRestart(): Promise<void> {
  if (isRebuilding) {
    rebuildPending = true;
    return;
  }

  isRebuilding = true;
  console.log("\n[desktop:dev] Source changed, rebuilding...");

  const success = await runBuild();
  isRebuilding = false;

  if (success) {
    startElectron();
  } else {
    console.error("[desktop:dev] Build failed. Waiting for fixes...");
  }

  if (rebuildPending) {
    rebuildPending = false;
    void rebuildAndRestart();
  }
}

function triggerRebuild(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void rebuildAndRestart();
  }, 300);
}

// Initial boot
console.log("[desktop:dev] Initial desktop build...");
const initialSuccess = await runBuild();
if (initialSuccess) {
  startElectron();
} else {
  console.error("[desktop:dev] Initial build failed.");
}

// Watch src directory
console.log(`[desktop:dev] Watching ${srcDir} for changes...`);
watch(srcDir, { recursive: true }, (_eventType, filename) => {
  if (
    filename &&
    (filename.endsWith(".ts") ||
      filename.endsWith(".tsx") ||
      filename.endsWith(".html"))
  ) {
    triggerRebuild();
  }
});
