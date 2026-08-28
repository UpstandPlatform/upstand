import { describe, expect, test } from "bun:test";
import {
  controlPlaneExportRequestSchema,
  controlPlaneOwnerRepairRequestSchema,
  controlPlaneOwnerTransferRequestSchema,
  parseTransferPassphrase,
} from "./control-plane-transfer.validation";

describe("control-plane transfer request validation", () => {
  test("accepts bounded export requests and applies the safe default", () => {
    expect(controlPlaneExportRequestSchema.parse({})).toEqual({
      includeSecrets: false,
    });
    expect(
      controlPlaneExportRequestSchema.parse({
        includeSecrets: true,
        passphrase: "  correct horse battery staple  ",
      }),
    ).toEqual({
      includeSecrets: true,
      passphrase: "  correct horse battery staple  ",
    });
  });

  test("rejects unknown fields and unsafe passphrases before the KDF", () => {
    expect(() =>
      controlPlaneExportRequestSchema.parse({
        includeSecrets: false,
        extra: 1,
      }),
    ).toThrow();
    expect(() =>
      controlPlaneExportRequestSchema.parse({
        includeSecrets: true,
        passphrase: "short",
      }),
    ).toThrow();
    expect(() =>
      controlPlaneExportRequestSchema.parse({
        includeSecrets: true,
        passphrase: " ".repeat(12),
      }),
    ).toThrow();
    expect(() =>
      controlPlaneExportRequestSchema.parse({
        includeSecrets: true,
        passphrase: "x".repeat(257),
      }),
    ).toThrow();
  });

  test("requires exact owner confirmations and bounded target IDs", () => {
    expect(
      controlPlaneOwnerRepairRequestSchema.safeParse({
        confirmation: "REPAIR_INSTANCE_OWNERSHIP",
      }).success,
    ).toBe(true);
    expect(
      controlPlaneOwnerRepairRequestSchema.safeParse({
        confirmation: "REPAIR_INSTANCE_OWNERSHIP",
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      controlPlaneOwnerTransferRequestSchema.parse({
        newOwnerUserId: "  user-1  ",
        confirmation: "TRANSFER_INSTANCE_OWNERSHIP",
      }),
    ).toEqual({
      newOwnerUserId: "user-1",
      confirmation: "TRANSFER_INSTANCE_OWNERSHIP",
    });
  });

  test("preserves exact import passphrase characters instead of trimming them", () => {
    const passphrase = "  correct horse battery staple  ";
    expect(parseTransferPassphrase(passphrase)).toEqual({
      success: true,
      data: passphrase,
    });
    expect(parseTransferPassphrase(undefined)).toEqual({
      success: true,
      data: undefined,
    });
    expect(parseTransferPassphrase("short")).toEqual({ success: false });
  });
});
