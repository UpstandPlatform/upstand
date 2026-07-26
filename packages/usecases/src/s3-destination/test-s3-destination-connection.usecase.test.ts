import { describe, expect, test } from "bun:test";
import {
  buildRcloneArguments,
  filterSafeEncryptionFlags,
} from "./test-s3-destination-connection.usecase";

describe("S3 connection command arguments", () => {
  test("keeps every user value as an independent argument", () => {
    const args = buildRcloneArguments({
      provider: "AWS",
      accessKeyId: "access; touch /tmp/pwned",
      secretAccessKey: "secret$(id)",
      region: "us-east-1",
      endpoint: 'https://s3.example.test/" --config /tmp/pwned',
      bucket: "bucket; echo pwned",
    });

    expect(args).toContain("--s3-access-key-id=access; touch /tmp/pwned");
    expect(args).toContain("--s3-secret-access-key=secret$(id)");
    expect(args).toContain(
      '--s3-endpoint=https://s3.example.test/" --config /tmp/pwned',
    );
    expect(args).toContain(":s3:bucket; echo pwned");
    expect(args).not.toContain("--header= X-Test: value");
  });

  test("filters safe S3 encryption and TLS flags and strips unsafe flags", () => {
    const rawFlags = [
      "--s3-server-side-encryption=aws:kms",
      "--s3-sse-kms-key-id=arn:aws:kms:us-east-1:123456789012:key/test-key",
      "--s3-sse-customer-algorithm=AES256",
      "--no-check-certificate",
      "--config=/tmp/malicious",
      "--cache-dir=/tmp/bad",
      "--exec=touch /tmp/pwned",
    ];

    const safeFlags = filterSafeEncryptionFlags(rawFlags);
    expect(safeFlags).toEqual([
      "--s3-server-side-encryption=aws:kms",
      "--s3-sse-kms-key-id=arn:aws:kms:us-east-1:123456789012:key/test-key",
      "--s3-sse-customer-algorithm=AES256",
      "--no-check-certificate",
    ]);

    const args = buildRcloneArguments({
      provider: "AWS",
      accessKeyId: "accessKey",
      secretAccessKey: "secretKey",
      region: "us-east-1",
      endpoint: "https://s3.amazonaws.com",
      bucket: "my-bucket",
      additionalFlags: rawFlags,
    });

    expect(args).toContain("--s3-server-side-encryption=aws:kms");
    expect(args).toContain(
      "--s3-sse-kms-key-id=arn:aws:kms:us-east-1:123456789012:key/test-key",
    );
    expect(args).toContain("--no-check-certificate");
    expect(args).not.toContain("--config=/tmp/malicious");
    expect(args).not.toContain("--exec=touch /tmp/pwned");
  });
});
