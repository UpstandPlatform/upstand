import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IUnitOfWork } from "@upstand/domain";
import { assertPublicHttpUrl } from "@upstand/platform/network/outbound";
import { z } from "zod";
import { ensureCaCertificateFile } from "../backup/backup-storage";

const execFileAsync = promisify(execFile);

export const TestS3DestinationConnectionInputSchema = z.object({
  organizationId: z.string().min(1, "Organization ID is required"),
  provider: z.string().min(1, "Provider is required"),
  accessKeyId: z.string().min(1, "Access Key Id is required"),
  secretAccessKey: z.string().min(1, "Secret Access Key is required"),
  bucket: z.string().min(1, "Bucket is required"),
  region: z.string(),
  endpoint: z.string().min(1, "Endpoint is required"),
  certificateId: z.string().nullable().optional(),
  caCertificatePem: z.string().optional(),
  additionalFlags: z.array(z.string()).optional(),
  // Connection tests permit safe S3 encryption, TLS, and CA certificate flags from additionalFlags.
});

export type TestS3DestinationConnectionInput = z.infer<
  typeof TestS3DestinationConnectionInputSchema
>;

const SAFE_CONNECTION_FLAG_PATTERN =
  /^--(no-check-certificate|ca-cert|s3-insecure-skip-verify|s3-(server-side-encryption|sse-kms-key-id|sse-customer-algorithm|sse-customer-key|sse-customer-key-md5))(=.*)?$/i;

export function filterSafeEncryptionFlags(flags?: string[]): string[] {
  if (!Array.isArray(flags)) return [];
  return flags.filter((flag) => SAFE_CONNECTION_FLAG_PATTERN.test(flag.trim()));
}

export function buildRcloneArguments(
  input: Pick<
    TestS3DestinationConnectionInput,
    | "provider"
    | "accessKeyId"
    | "secretAccessKey"
    | "region"
    | "endpoint"
    | "bucket"
    | "caCertificatePem"
    | "additionalFlags"
  >,
): string[] {
  const encryptionFlags = filterSafeEncryptionFlags(input.additionalFlags);
  const caFlags: string[] = [];
  if (input.caCertificatePem?.trim()) {
    const certPath = ensureCaCertificateFile(input.caCertificatePem);
    caFlags.push(`--ca-cert=${certPath}`);
  }

  return [
    "ls",
    `--s3-provider=${input.provider}`,
    `--s3-access-key-id=${input.accessKeyId}`,
    `--s3-secret-access-key=${input.secretAccessKey}`,
    `--s3-region=${input.region}`,
    `--s3-endpoint=${input.endpoint}`,
    "--s3-no-check-bucket",
    "--s3-force-path-style",
    ...caFlags,
    ...encryptionFlags,
    "--retries",
    "1",
    "--low-level-retries",
    "1",
    "--timeout",
    "10s",
    "--contimeout",
    "5s",
    `:s3:${input.bucket}`,
  ];
}

export class TestS3DestinationConnectionUseCase {
  constructor(private readonly uow?: IUnitOfWork) {}

  async execute(
    input: TestS3DestinationConnectionInput,
  ): Promise<{ success: boolean; output?: string }> {
    try {
      let caCertificatePem = input.caCertificatePem;
      if (!caCertificatePem && input.certificateId && this.uow) {
        const cert = await this.uow.certificateRepository.findById(
          input.certificateId,
        );
        caCertificatePem = cert?.certificatePem;
      }

      const endpoint = await assertPublicHttpUrl(input.endpoint);
      const { stdout } = await execFileAsync(
        "rclone",
        buildRcloneArguments({
          ...input,
          endpoint: endpoint.toString(),
          caCertificatePem,
        }),
        { timeout: 15_000, maxBuffer: 1024 * 1024 },
      );
      return { success: true, output: stdout };
    } catch (error: unknown) {
      throw new Error(
        error instanceof Error
          ? error.message
          : "Failed to connect to S3 bucket",
      );
    }
  }
}
