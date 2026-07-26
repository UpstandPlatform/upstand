import { describe, expect, test } from "bun:test";
import type { S3Destination } from "@upstand/domain";
import { encryptSecret } from "@upstand/platform/crypto/secret-box";
import { rcloneRemote, toBackupStorageDestination } from "./backup-storage";

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
  test("configures rclone flags with SSE-S3 (AES256) encryption", () => {
    const destination = createMockDestination([
      "--s3-server-side-encryption=AES256",
    ]);

    const storage = toBackupStorageDestination(destination);

    expect(storage.bucket).toBe("secure-backups-bucket");
    expect(storage.rcloneFlags).toContain("--s3-provider=AWS");
    expect(storage.rcloneFlags).toContain("--s3-access-key-id=test-access-key");
    expect(storage.rcloneFlags).toContain(
      "--s3-secret-access-key=test-secret-key",
    );
    expect(storage.rcloneFlags).toContain("--s3-region=us-west-2");
    expect(storage.rcloneFlags).toContain(
      "--s3-endpoint=https://s3.us-west-2.amazonaws.com",
    );
    expect(storage.rcloneFlags).toContain("--s3-server-side-encryption=AES256");
  });

  test("configures rclone flags with SSE-KMS encryption and KMS Key ID", () => {
    const destination = createMockDestination([
      "--s3-server-side-encryption=aws:kms",
      "--s3-sse-kms-key-id=arn:aws:kms:us-west-2:123456789012:key/my-kms-key",
    ]);

    const storage = toBackupStorageDestination(destination);

    expect(storage.rcloneFlags).toContain(
      "--s3-server-side-encryption=aws:kms",
    );
    expect(storage.rcloneFlags).toContain(
      "--s3-sse-kms-key-id=arn:aws:kms:us-west-2:123456789012:key/my-kms-key",
    );
  });

  test("configures rclone flags with SSE-C (Customer Key) encryption", () => {
    const destination = createMockDestination([
      "--s3-sse-customer-algorithm=AES256",
      "--s3-sse-customer-key=c2VjcmV0LWN1c3RvbWVyLWtleS0xMjM0NQ==",
    ]);

    const storage = toBackupStorageDestination(destination);

    expect(storage.rcloneFlags).toContain("--s3-sse-customer-algorithm=AES256");
    expect(storage.rcloneFlags).toContain(
      "--s3-sse-customer-key=c2VjcmV0LWN1c3RvbWVyLWtleS0xMjM0NQ==",
    );
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
      ":s3:secure-backups-bucket/resource-123/backups/db-2026-07-25.sql.gz",
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
