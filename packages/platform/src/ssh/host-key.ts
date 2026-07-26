import sshpk from "sshpk";

export function normalizeHostKeyFingerprint(value: string): string {
  const normalized = value.trim();
  if (!/^SHA256:[A-Za-z0-9+/=]+$/.test(normalized)) {
    throw new Error("SSH host fingerprint must use SHA256:base64 format");
  }
  return normalized;
}

export function verifyHostKeyFingerprint(
  expected: string,
  received: string | Buffer,
): boolean {
  const normalized = normalizeHostKeyFingerprint(expected);
  if (typeof received === "string") {
    // ssh2 invokes the verifier with a lowercase hexadecimal digest when
    // `hostHash: "sha256"` is configured. Persisted fingerprints use the
    // OpenSSH SHA256:base64 representation, so compare the same digest.
    if (/^[a-f0-9]{64}$/i.test(received)) {
      const base64 = normalized.slice("SHA256:".length);
      const padding = "=".repeat((4 - (base64.length % 4)) % 4);
      return (
        Buffer.from(base64 + padding, "base64").toString("hex") ===
        received.toLowerCase()
      );
    }

    // ssh2 returns the SHA-256 fingerprint without the OpenSSH `SHA256:`
    // label when `hostHash: "sha256"` is configured.
    const value = received.startsWith("SHA256:")
      ? received
      : `SHA256:${received}`;
    return value.replace(/=+$/, "") === normalized.replace(/=+$/, "");
  }
  try {
    return (
      sshpk
        .parseKey(received, "ssh")
        .fingerprint("sha256")
        .toString()
        .replace(/=+$/, "") === normalized.replace(/=+$/, "")
    );
  } catch {
    return false;
  }
}

export function hostVerifierForFingerprint(expected: string) {
  const normalized = normalizeHostKeyFingerprint(expected);
  return (received: string | Buffer): boolean =>
    verifyHostKeyFingerprint(normalized, received);
}

import crypto from "node:crypto";
import { Client } from "ssh2";

export function scanHostKey(
  host: string,
  port = 22,
  timeout = 10000,
): Promise<{ fingerprint: string; algorithm: string; key: string }> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let resolved = false;

    const cleanup = () => {
      conn.end();
      resolved = true;
    };

    const timer = setTimeout(() => {
      if (!resolved) {
        cleanup();
        reject(new Error("Connection timeout scanning host key"));
      }
    }, timeout);

    conn.on("error", (err: Error) => {
      if (!resolved) {
        clearTimeout(timer);
        cleanup();
        reject(err);
      }
    });

    conn.on("ready", () => {
      if (!resolved) {
        clearTimeout(timer);
        cleanup();
        reject(
          new Error("Connection established but no host key was verified"),
        );
      }
    });

    conn.connect({
      host,
      port,
      username: "root",
      readyTimeout: timeout,
      hostVerifier: (keyBuf: Buffer) => {
        try {
          const algLen = keyBuf.readUInt32BE(0);
          const algorithm = keyBuf.subarray(4, 4 + algLen).toString("utf8");
          const key = keyBuf.toString("base64");
          const fingerprint =
            "SHA256:" +
            crypto.createHash("sha256").update(keyBuf).digest("base64");

          clearTimeout(timer);
          cleanup();
          resolve({ fingerprint, algorithm, key });
        } catch (e) {
          clearTimeout(timer);
          cleanup();
          reject(e);
        }
        return false;
      },
    });
  });
}
