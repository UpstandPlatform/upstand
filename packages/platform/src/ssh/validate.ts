import net from "node:net";
import sshpk from "sshpk";

export class KeyPairMismatchError extends Error {
  constructor() {
    super("The private key does not correspond to the given public key");
  }
}

export function assertKeyPairMatches(
  privateKeyPem: string,
  publicKeyLine: string,
): void {
  let priv: sshpk.PrivateKey;
  let pub: sshpk.Key;
  try {
    priv = sshpk.parsePrivateKey(privateKeyPem, "auto");
  } catch {
    throw new Error("Could not parse private key");
  }
  try {
    pub = sshpk.parseKey(publicKeyLine, "ssh");
  } catch {
    throw new Error("Could not parse public key");
  }
  if (
    priv.toPublic().fingerprint("sha256").toString() !==
    pub.fingerprint("sha256").toString()
  ) {
    throw new KeyPairMismatchError();
  }
}

export function fingerprintOf(publicKeyLine: string): string {
  return sshpk.parseKey(publicKeyLine, "ssh").fingerprint("sha256").toString();
}

export function algorithmOf(publicKeyLine: string): "ed25519" | "rsa" {
  return sshpk.parseKey(publicKeyLine, "ssh").type === "ed25519"
    ? "ed25519"
    : "rsa";
}

export function normalizePrivateKey(privateKeyPem: string): string {
  try {
    const priv = sshpk.parsePrivateKey(privateKeyPem, "auto");
    if (priv.type === "ed25519") {
      return priv.toString("openssh");
    }
    if (priv.type === "rsa") {
      return priv.toString("pkcs1");
    }
    return privateKeyPem;
  } catch {
    return privateKeyPem;
  }
}

export function isSafeSshHost(value: string): boolean {
  if (
    value.trim() !== value ||
    /\s/.test(value) ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    return false;
  }
  if (net.isIP(value)) return true;
  if (value.length > 253 || value.startsWith(".") || value.endsWith(".")) {
    return false;
  }
  return value
    .split(".")
    .every((label) =>
      /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label),
    );
}

export function isSafeSshUsername(value: string): boolean {
  return (
    value.trim() === value && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)
  );
}
