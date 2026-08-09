import { describe, expect, test } from "bun:test";
import {
  decryptPortableSecretBundle,
  encryptPortableSecretBundle,
} from "./portable-secret-bundle";

describe("portable secret bundles", () => {
  test("uses memory-hard derivation and authenticated encryption", async () => {
    const bundle = await encryptPortableSecretBundle(
      { "credential-1": "private-value" },
      "correct horse battery staple",
    );
    expect(bundle.descriptor.kdf).toBe("scrypt");
    expect(bundle.descriptor.cost).toBeGreaterThanOrEqual(32_768);
    expect(bundle.ciphertext).not.toContain("private-value");
    expect(
      await decryptPortableSecretBundle(bundle, "correct horse battery staple"),
    ).toEqual({ "credential-1": "private-value" });
  });

  test("fails closed for wrong passphrases and tampering", async () => {
    const bundle = await encryptPortableSecretBundle(
      { value: "secret" },
      "a sufficiently long passphrase",
    );
    await expect(
      decryptPortableSecretBundle(bundle, "a different long passphrase"),
    ).rejects.toThrow("Unable to decrypt");
    await expect(
      decryptPortableSecretBundle(
        { ...bundle, ciphertext: `${bundle.ciphertext.slice(0, -2)}AA` },
        "a sufficiently long passphrase",
      ),
    ).rejects.toThrow("checksum mismatch");
  });
});
