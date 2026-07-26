import { generateKeyPairSync } from "node:crypto";
import sshpk from "sshpk";

export interface GeneratedSshKeyPair {
  privateKey: string;
  publicKey: string;
  fingerprint: string;
}

export function generateSshKeyPair(
  type: "ed25519" | "rsa",
  comment: string,
): GeneratedSshKeyPair {
  if (type === "rsa") {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: "spki",
        format: "pem",
      },
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
      },
    });

    const parsedPublic = sshpk.parseKey(publicKey, "pem");
    const openSshPub = `${parsedPublic.toString("ssh")} ${comment}`;
    const fingerprint = parsedPublic.fingerprint("sha256").toString();

    const parsedPrivate = sshpk.parsePrivateKey(privateKey, "pem");
    const formattedPrivateKey = parsedPrivate.toString("pkcs1");

    return {
      privateKey: formattedPrivateKey,
      publicKey: openSshPub,
      fingerprint,
    };
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });

  const parsedPublic = sshpk.parseKey(publicKey, "pem");
  const openSshPub = `${parsedPublic.toString("ssh")} ${comment}`;
  const fingerprint = parsedPublic.fingerprint("sha256").toString();

  const parsedPrivate = sshpk.parsePrivateKey(privateKey, "pem");
  const formattedPrivateKey = parsedPrivate.toString("openssh");

  return {
    privateKey: formattedPrivateKey,
    publicKey: openSshPub,
    fingerprint,
  };
}

export function generateEd25519KeyPair(comment: string): GeneratedSshKeyPair {
  return generateSshKeyPair("ed25519", comment);
}
