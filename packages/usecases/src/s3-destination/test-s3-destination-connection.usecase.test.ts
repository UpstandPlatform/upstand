import { describe, expect, test } from "bun:test";
import {
  buildRcloneArguments,
  buildRcloneEnvironment,
  filterSafeEncryptionFlags,
} from "./test-s3-destination-connection.usecase";

describe("S3 connection command arguments", () => {
  test("keeps secrets and endpoint configuration out of command arguments", () => {
    const input = {
      provider: "AWS",
      accessKeyId: "access; touch /tmp/pwned",
      secretAccessKey: "secret$(id)",
      region: "us-east-1",
      endpoint: 'https://s3.example.test/" --config /tmp/pwned',
      bucket: "bucket; echo pwned",
    };
    const args = buildRcloneArguments(input);
    const environment = buildRcloneEnvironment(input);

    expect(args).not.toContain("access; touch /tmp/pwned");
    expect(args).not.toContain("secret$(id)");
    expect(args).not.toContain('https://s3.example.test/" --config /tmp/pwned');
    expect(args).toContain("upstand:bucket; echo pwned");
    expect(environment).toMatchObject({
      RCLONE_CONFIG_UPSTAND_ACCESS_KEY_ID: "access; touch /tmp/pwned",
      RCLONE_CONFIG_UPSTAND_SECRET_ACCESS_KEY: "secret$(id)",
      RCLONE_CONFIG_UPSTAND_ENDPOINT:
        'https://s3.example.test/" --config /tmp/pwned',
    });
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

    const environment = buildRcloneEnvironment({
      provider: "AWS",
      accessKeyId: "accessKey",
      secretAccessKey: "secretKey",
      region: "us-east-1",
      endpoint: "https://s3.amazonaws.com",
      additionalFlags: rawFlags,
    });

    expect(environment).toMatchObject({
      RCLONE_CONFIG_UPSTAND_SERVER_SIDE_ENCRYPTION: "aws:kms",
      RCLONE_CONFIG_UPSTAND_SSE_KMS_KEY_ID:
        "arn:aws:kms:us-east-1:123456789012:key/test-key",
      RCLONE_CONFIG_UPSTAND_SSE_CUSTOMER_ALGORITHM: "AES256",
    });
    expect(args).not.toContain("--s3-server-side-encryption=aws:kms");
    expect(args).not.toContain(
      "--s3-sse-kms-key-id=arn:aws:kms:us-east-1:123456789012:key/test-key",
    );
    expect(args).toContain("--no-check-certificate");
    expect(args).not.toContain("--config=/tmp/malicious");
    expect(args).not.toContain("--exec=touch /tmp/pwned");
  });
});
