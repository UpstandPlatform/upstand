import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, join } from "node:path";

type LockRecord = { pid: number; acquiredAt: string };

let heldLock: string | null = null;

function lockPath(dataDir: string): string {
  const name = dataDir.split(/[\\/]/).pop() ?? "data";
  return join(dirname(dataDir), `${name}.lock`);
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function readLock(file: string): LockRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      "pid" in parsed &&
      typeof parsed.pid === "number" &&
      "acquiredAt" in parsed &&
      typeof parsed.acquiredAt === "string"
    ) {
      return { pid: parsed.pid, acquiredAt: parsed.acquiredAt };
    }
  } catch {
    // A partially written lock is safe to reclaim when no owner is alive.
  }
  return null;
}

export async function acquirePgliteLock(
  dataDir: string,
  options: { waitMs?: number; pollMs?: number } = {},
): Promise<void> {
  const file = lockPath(dataDir);
  const waitMs = options.waitMs ?? 30_000;
  const pollMs = options.pollMs ?? 250;
  const deadline = Date.now() + waitMs;

  while (true) {
    try {
      const handle = await open(file, "wx", 0o600);
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          acquiredAt: new Date().toISOString(),
        }),
        "utf8",
      );
      await handle.close();
      heldLock = file;
      return;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST"
      ) {
        throw error;
      }
      const record = readLock(file);
      if (!record || !processIsAlive(record.pid)) {
        try {
          unlinkSync(file);
        } catch {
          // Another recovery attempt may have won the race.
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          "PGlite data directory is already in use by process " +
            record.pid +
            ".",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

export function releasePgliteLock(): void {
  if (!heldLock) return;
  try {
    const record = readLock(heldLock);
    if (!record || record.pid === process.pid) unlinkSync(heldLock);
  } catch {
    // Best effort during process shutdown.
  } finally {
    heldLock = null;
  }
}

export function removeStalePgliteControlFile(dataDir: string): void {
  const file = join(dataDir, "postmaster.pid");
  if (existsSync(file)) {
    try {
      unlinkSync(file);
    } catch {
      // PGlite will report a useful startup error if the file is still held.
    }
  }
}
