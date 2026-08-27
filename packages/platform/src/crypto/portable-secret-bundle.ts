import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
} from "node:crypto";

const SCRYPT_COST = 32_768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const KEY_LENGTH = 32;
const MIN_PASSPHRASE_LENGTH = 12;
const MAX_PASSPHRASE_LENGTH = 256;

export interface PortableSecretBundleDescriptor {
  algorithm: "aes-256-gcm";
  kdf: "scrypt";
  cost: number;
  blockSize: number;
  parallelism: number;
  keyLength: 32;
  salt: string;
  nonce: string;
  authTag: string;
  checksum: string;
}

export interface PortableSecretBundle {
  descriptor: PortableSecretBundleDescriptor;
  ciphertext: string;
}

function deriveKey(
  passphrase: string,
  salt: Buffer,
  descriptor: Pick<
    PortableSecretBundleDescriptor,
    "cost" | "blockSize" | "parallelism" | "keyLength"
  >,
): Promise<Buffer> {
  if (
    passphrase.length < MIN_PASSPHRASE_LENGTH ||
    passphrase.length > MAX_PASSPHRASE_LENGTH ||
    passphrase.trim().length === 0
  ) {
    throw new Error(
      "Transfer passphrase must be 12 to 256 characters and not whitespace-only",
    );
  }
  return new Promise((resolve, reject) => {
    scrypt(
      passphrase,
      salt,
      descriptor.keyLength,
      {
        N: descriptor.cost,
        r: descriptor.blockSize,
        p: descriptor.parallelism,
        maxmem: 128 * 1024 * 1024,
      },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

function checksum(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export async function encryptPortableSecretBundle(
  secrets: Readonly<Record<string, string>>,
  passphrase: string,
): Promise<PortableSecretBundle> {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const parameters = {
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelism: SCRYPT_PARALLELISM,
    keyLength: KEY_LENGTH as 32,
  };
  const key = await deriveKey(passphrase, salt, parameters);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const plaintext = Buffer.from(JSON.stringify(secrets), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  key.fill(0);
  plaintext.fill(0);
  return {
    descriptor: {
      algorithm: "aes-256-gcm",
      kdf: "scrypt",
      ...parameters,
      salt: salt.toString("base64"),
      nonce: nonce.toString("base64"),
      authTag: authTag.toString("base64"),
      checksum: checksum(ciphertext),
    },
    ciphertext: ciphertext.toString("base64"),
  };
}

export async function decryptPortableSecretBundle(
  bundle: PortableSecretBundle,
  passphrase: string,
): Promise<Record<string, string>> {
  const ciphertext = Buffer.from(bundle.ciphertext, "base64");
  if (checksum(ciphertext) !== bundle.descriptor.checksum) {
    throw new Error("Encrypted secret bundle checksum mismatch");
  }
  const salt = Buffer.from(bundle.descriptor.salt, "base64");
  const nonce = Buffer.from(bundle.descriptor.nonce, "base64");
  const key = await deriveKey(passphrase, salt, bundle.descriptor);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(Buffer.from(bundle.descriptor.authTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    try {
      const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Secret bundle payload is invalid");
      }
      for (const value of Object.values(parsed)) {
        if (typeof value !== "string") {
          throw new Error("Secret bundle values must be strings");
        }
      }
      return parsed as Record<string, string>;
    } finally {
      plaintext.fill(0);
    }
  } catch (error) {
    throw new Error("Unable to decrypt secret bundle", { cause: error });
  } finally {
    key.fill(0);
  }
}
