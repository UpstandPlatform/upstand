import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env, getInheritedEnv } from "@upstand/env/server";
import { assertSafeSshTarget } from "@upstand/platform/network/outbound";
import {
  normalizeHostKeyFingerprint,
  verifyHostKeyFingerprint,
} from "@upstand/platform/ssh/host-key";

export type GitSshTarget = {
  host: string;
  port: number;
};

export type PinnedGitSshEnvironment = {
  environment: NodeJS.ProcessEnv;
  cleanup: () => void;
};

function parseGitSshTarget(cloneUrl: string): GitSshTarget | null {
  if (cloneUrl.startsWith("ssh://")) {
    const url = new URL(cloneUrl);
    if (!url.hostname || url.username === "") {
      throw new Error("SSH Git URL must include a host and user");
    }
    return {
      host: url.hostname,
      port: Number(url.port) || 22,
    };
  }

  const match = /^[^/@\s:]+@([^/\s:]+|\[[^\]]+\]):/.exec(cloneUrl);
  if (!match?.[1]) return null;
  return {
    host: match[1].replace(/^\[|\]$/g, ""),
    port: 22,
  };
}

function assertSafeScanHost(host: string): void {
  if (!/^[A-Za-z0-9._:-]+$/.test(host)) {
    throw new Error("SSH Git host contains unsupported characters");
  }
}

function scanHostKeys(
  target: GitSshTarget,
  timeoutMs: number,
): Promise<string> {
  assertSafeScanHost(target.host);
  const allowlistedHosts = (env.UPSTAND_GIT_PROVIDER_ALLOWED_HOSTS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return assertSafeSshTarget(target.host, allowlistedHosts).then(
    (validatedHost) =>
      new Promise((resolve, reject) => {
        const child = spawn(
          "ssh-keyscan",
          [
            "-T",
            String(Math.max(1, Math.ceil(timeoutMs / 1_000))),
            "-p",
            String(target.port),
            validatedHost,
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        let stdout = "";
        let stdoutBytes = 0;
        let stderr = "";
        let stderrBytes = 0;
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill();
          reject(new Error("Timed out while scanning the SSH Git host key"));
        }, timeoutMs);

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdoutBytes += Buffer.byteLength(chunk);
          if (stdoutBytes > 1_048_576) {
            settled = true;
            clearTimeout(timer);
            child.kill();
            reject(new Error("SSH host-key scan output exceeded its limit"));
            return;
          }
          stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
          stderrBytes += Buffer.byteLength(chunk);
          if (stderrBytes <= 65_536) stderr += chunk;
        });
        child.once("error", (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        });
        child.once("close", (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (code !== 0 && !stdout.trim()) {
            reject(
              new Error(
                `SSH host-key scan failed${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
              ),
            );
            return;
          }
          resolve(stdout);
        });
      }),
  );
}

export function matchingKnownHostLines(
  output: string,
  expectedFingerprint: string,
): string[] {
  const lines: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const fields = trimmed.split(/\s+/);
    const key = fields[2];
    if (!key || !/^[A-Za-z0-9+/=]+$/.test(key)) continue;
    let keyBytes: Buffer;
    try {
      keyBytes = Buffer.from(key, "base64");
    } catch {
      continue;
    }
    const fingerprint = `SHA256:${createHash("sha256").update(keyBytes).digest("base64")}`;
    if (verifyHostKeyFingerprint(expectedFingerprint, fingerprint)) {
      lines.push(trimmed);
    }
  }
  return lines;
}

function shellQuote(value: string): string {
  return `"${value.replace(/["\\$`]/g, "\\$&")}"`;
}

export function knownHostLabel(target: GitSshTarget): string {
  return target.port === 22 ? target.host : `[${target.host}]:${target.port}`;
}

export function bindKnownHostLine(line: string, target: GitSshTarget): string {
  const fields = line.trim().split(/\s+/);
  if (fields.length < 3) return line.trim();
  fields[0] = knownHostLabel(target);
  return fields.join(" ");
}

export function isSshGitUrl(cloneUrl: string): boolean {
  return (
    cloneUrl.startsWith("ssh://") ||
    /^[^/@\s:]+@(?:\[[^\]]+\]|[^/\s:]+):/.test(cloneUrl)
  );
}

export async function createPinnedGitSshEnvironment(
  cloneUrl: string,
  expectedFingerprint: string,
  sshKeyPath: string | undefined,
  baseEnvironment: NodeJS.ProcessEnv | Record<string, string> | undefined,
  timeoutMs: number,
): Promise<PinnedGitSshEnvironment> {
  const normalizedFingerprint =
    normalizeHostKeyFingerprint(expectedFingerprint);
  const target = parseGitSshTarget(cloneUrl);
  if (!target) {
    throw new Error("SSH host-key pinning was requested for a non-SSH Git URL");
  }
  const output = await scanHostKeys(target, timeoutMs);
  const matchingLines = matchingKnownHostLines(
    output,
    normalizedFingerprint,
  ).map((line) => bindKnownHostLine(line, target));
  if (matchingLines.length === 0) {
    throw new Error(
      "SSH Git host key did not match the configured fingerprint",
    );
  }

  const knownHostsPath = path.join(
    os.tmpdir(),
    `upstand-git-known-hosts-${randomUUID()}`,
  );
  fs.writeFileSync(knownHostsPath, `${matchingLines.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const sshCommand = [
    "ssh",
    ...(sshKeyPath
      ? ["-i", shellQuote(sshKeyPath), "-o", "IdentitiesOnly=yes"]
      : []),
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${shellQuote(knownHostsPath)}`,
  ].join(" ");

  return {
    environment: {
      ...getInheritedEnv(),
      ...(baseEnvironment ?? {}),
      GIT_SSH_COMMAND: sshCommand,
    },
    cleanup: () => {
      fs.rmSync(knownHostsPath, { force: true });
    },
  };
}
