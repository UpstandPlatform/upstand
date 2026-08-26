import { describe, expect, test } from "bun:test";
import type { S3Destination } from "@upstand/domain";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import {
  assertBackupStorageEndpoint,
  rcloneRemote,
  toBackupStorageDestination,
} from "./backup-storage";

function createMockDestination(additionalFlags: string[] = []): S3Destination {
  return {
    id: "s3-dest-1",
    organizationId: "org-1",
    name: "Secure S3 Backup",
    provider: "AWS",
    accessKeyId: JSON.stringify(encryptSecret("test-access-key")),
    secretAccessKey: JSON.stringify(encryptSecret("test-secret-key")),
    bucket: "secure-backups-bucket",
    region: "us-west-2",
    endpoint: "https://s3.us-west-2.amazonaws.com",
    additionalFlags: JSON.stringify(additionalFlags),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("S3 Backup & Restore Encryption Storage Destination", () => {
  test("rejects a backup endpoint targeting loopback before rclone connects", async () => {
    await expect(
      assertBackupStorageEndpoint("https://127.0.0.1/internal-storage"),
    ).rejects.toThrow();
  });

  test("defaults backup objects to SSE-S3 when no encryption mode is supplied", () => {
    const storage = toBackupStorageDestination(createMockDestination());

    expect(storage.rcloneEnvironment).toMatchObject({
      RCLONE_CONFIG_UPSTAND_SERVER_SIDE_ENCRYPTION: "AES256",
    });
  });

  test("configures rclone flags with SSE-S3 (AES256) encryption", () => {
    const destination = createMockDestination([
      "--s3-server-side-encryption=AES256",
    ]);

    const storage = toBackupStorageDestination(destination);

    expect(storage.bucket).toBe("secure-backups-bucket");
    expect(storage.rcloneFlags).not.toContain("test-access-key");
    expect(storage.rcloneFlags).not.toContain("test-secret-key");
    expect(storage.rcloneEnvironment).toMatchObject({
      RCLONE_CONFIG_UPSTAND_TYPE: "s3",
      RCLONE_CONFIG_UPSTAND_PROVIDER: "AWS",
      RCLONE_CONFIG_UPSTAND_ACCESS_KEY_ID: "test-access-key",
      RCLONE_CONFIG_UPSTAND_SECRET_ACCESS_KEY: "test-secret-key",
      RCLONE_CONFIG_UPSTAND_REGION: "us-west-2",
      RCLONE_CONFIG_UPSTAND_ENDPOINT: "https://s3.us-west-2.amazonaws.com",
      RCLONE_CONFIG_UPSTAND_SERVER_SIDE_ENCRYPTION: "AES256",
    });
  });

  test("configures rclone flags with SSE-KMS encryption and KMS Key ID", () => {
    const destination = createMockDestination([
      "--s3-server-side-encryption=aws:kms",
      "--s3-sse-kms-key-id=arn:aws:kms:us-west-2:123456789012:key/my-kms-key",
    ]);

    const storage = toBackupStorageDestination(destination);

    expect(storage.rcloneEnvironment).toMatchObject({
      RCLONE_CONFIG_UPSTAND_SERVER_SIDE_ENCRYPTION: "aws:kms",
      RCLONE_CONFIG_UPSTAND_SSE_KMS_KEY_ID:
        "arn:aws:kms:us-west-2:123456789012:key/my-kms-key",
    });
  });

  test("configures rclone flags with SSE-C (Customer Key) encryption", () => {
    const destination = createMockDestination([
      "--s3-sse-customer-algorithm=AES256",
      "--s3-sse-customer-key=c2VjcmV0LWN1c3RvbWVyLWtleS0xMjM0NQ==",
    ]);

    const storage = toBackupStorageDestination(destination);

    expect(storage.rcloneFlags).not.toContain(
      "c2VjcmV0LWN1c3RvbWVyLWtleS0xMjM0NQ==",
    );
    expect(storage.rcloneEnvironment).toMatchObject({
      RCLONE_CONFIG_UPSTAND_SSE_CUSTOMER_ALGORITHM: "AES256",
      RCLONE_CONFIG_UPSTAND_SSE_CUSTOMER_KEY:
        "c2VjcmV0LWN1c3RvbWVyLWtleS0xMjM0NQ==",
    });
  });

  test("builds correct rclone remote key paths for encrypted backup runs", () => {
    const destination = createMockDestination([
      "--s3-server-side-encryption=AES256",
    ]);
    const storage = toBackupStorageDestination(destination);

    const remote = rcloneRemote(
      storage,
      "resource-123/backups/db-2026-07-25.sql.gz",
    );
    expect(remote).toBe(
      "upstand:secure-backups-bucket/resource-123/backups/db-2026-07-25.sql.gz",
    );
  });

  test("appends --ca-cert flag when a custom CA certificate PEM is passed", () => {
    const destination = createMockDestination();
    const mockPem =
      "-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAK...\n-----END CERTIFICATE-----";

    const storage = toBackupStorageDestination(destination, mockPem);

    const caFlag = storage.rcloneFlags.find((flag) =>
      flag.startsWith("--ca-cert="),
    );
    expect(caFlag).toBeDefined();
    expect(caFlag).toMatch(/--ca-cert=.*upstand-ca-.*\.pem/);
  });
});
