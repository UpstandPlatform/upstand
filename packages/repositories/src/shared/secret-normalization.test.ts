import { describe, expect, test } from "bun:test";
import {
  decryptSecret,
  encryptSecret,
} from "@upstand/platform/crypto/secret-box";

describe("Secret Storage Normalization & Encryption Helpers", () => {
  test("encryptSecret produces authenticated encrypted payload and decryptSecret restores original plaintext", () => {
    const secret = "sk_test_99887766554433221100";
    const payload = encryptSecret(secret);

    expect(typeof payload.ciphertext).toBe("string");
    expect(typeof payload.iv).toBe("string");
    expect(typeof payload.authTag).toBe("string");
    expect(payload.keyVersion).toBeGreaterThanOrEqual(1);

    const decrypted = decryptSecret(payload);
    expect(decrypted).toBe(secret);
  });

  test("Encrypted payload serialization is valid JSON string", () => {
    const raw = "my-super-secret-api-token";
    const encryptedJson = JSON.stringify(encryptSecret(raw));
    const parsed = JSON.parse(encryptedJson);

    expect(parsed.ciphertext).toBeDefined();
    expect(parsed.iv).toBeDefined();
    expect(parsed.authTag).toBeDefined();

    const restored = decryptSecret(parsed);
    expect(restored).toBe(raw);
  });
});
