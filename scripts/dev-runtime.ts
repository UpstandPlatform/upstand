import fs from "node:fs";
import path from "node:path";

export type DevMode = "cloud" | "self-hosted";

export type DevRuntimeState = {
  pid: number;
  mode: DevMode;
  root: string;
  startedAt: string;
};

const stateDirectory = path.resolve(import.meta.dir, "../.upstand");
export const devRuntimeStatePath = path.join(
  stateDirectory,
  "dev-runtime.json",
);

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processCommandLine(pid: number): string | undefined {
  const result =
    process.platform === "win32"
      ? Bun.spawnSync({
          cmd: [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`,
          ],
          stdout: "pipe",
          stderr: "ignore",
        })
      : Bun.spawnSync({
          cmd: ["ps", "-p", String(pid), "-o", "command="],
          stdout: "pipe",
          stderr: "ignore",
        });

  if (!result.success) return undefined;
  const commandLine = result.stdout.toString().trim();
  return commandLine || undefined;
}

function assertOwnedProcess(state: DevRuntimeState): void {
  const commandLine = processCommandLine(state.pid);
  const expectedRoot = path.resolve(state.root).toLowerCase();
  if (!commandLine?.toLowerCase().includes(expectedRoot)) {
    throw new Error(
      `Refusing to stop PID ${state.pid}: it is not an Upstand process from ${state.root}. Remove ${devRuntimeStatePath} only after verifying the process is gone.`,
    );
  }
}

function childPids(pid: number): number[] {
  if (process.platform === "win32") return [];
  const result = Bun.spawnSync({
    cmd: ["pgrep", "-P", String(pid)],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!result.success) return [];
  return result.stdout
    .toString()
    .split(/\r?\n/)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (processIsAlive(pid) && Date.now() < deadline) {
    await Bun.sleep(100);
  }
}

export async function stopProcessTree(pid: number): Promise<void> {
  if (!processIsAlive(pid)) return;
  if (process.platform === "win32") {
    const result = Bun.spawnSync({
      cmd: ["taskkill", "/PID", String(pid), "/T", "/F"],
      stdout: "inherit",
      stderr: "inherit",
    });
    if (!result.success) {
      throw new Error(
        `Could not stop the existing Upstand dev process (PID ${pid}).`,
      );
    }
    return;
  }

  const stopChildren = async (pid: number): Promise<void> => {
    for (const childPid of childPids(pid)) {
      if (processIsAlive(childPid)) await stopChildren(childPid);
    }
    if (processIsAlive(pid)) process.kill(pid, "SIGTERM");
  };

  await stopChildren(pid);
  await waitForExit(pid);
  if (processIsAlive(pid)) process.kill(pid, "SIGKILL");
}

export async function stopOwnedDevProcess(
  state: DevRuntimeState,
): Promise<void> {
  if (!processIsAlive(state.pid)) return;
  assertOwnedProcess(state);
  await stopProcessTree(state.pid);
}

function readState(): DevRuntimeState | undefined {
  try {
    return JSON.parse(
      fs.readFileSync(devRuntimeStatePath, "utf8"),
    ) as DevRuntimeState;
  } catch {
    return undefined;
  }
}

export async function claimDevRuntime(
  mode: DevMode,
  root: string,
): Promise<DevRuntimeState> {
  fs.mkdirSync(stateDirectory, { recursive: true });

  const existing = readState();
  if (existing) {
    if (processIsAlive(existing.pid)) {
      await stopOwnedDevProcess(existing);
      console.log(`✔ Stopped existing Upstand ${existing.mode} dev runtime.`);
    }
    fs.rmSync(devRuntimeStatePath, { force: true });
  }

  const state: DevRuntimeState = {
    pid: process.pid,
    mode,
    root: path.resolve(root),
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(devRuntimeStatePath, JSON.stringify(state, null, 2), {
    encoding: "utf8",
    flag: "wx",
  });
  return state;
}

export function releaseDevRuntime(pid: number): void {
  const state = readState();
  if (state?.pid === pid) fs.rmSync(devRuntimeStatePath, { force: true });
}
