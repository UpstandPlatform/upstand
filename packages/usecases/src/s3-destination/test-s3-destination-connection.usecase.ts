import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IUnitOfWork } from "@upstand/domain";
import { env, getInheritedEnv } from "@upstand/env/server";
import { assertConfiguredHttpUrl } from "@upstand/platform/network/outbound";
import { z } from "zod";
import {
  buildRcloneS3Configuration,
  filterSafeS3AdditionalFlags,
} from "../backup/backup-storage";
import { resolveCertificateForOrganization } from "../certificate/certificate-reference";

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

export function filterSafeEncryptionFlags(flags?: string[]): string[] {
  return filterSafeS3AdditionalFlags(flags);
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
  const configuration = buildRcloneS3Configuration({
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    provider: input.provider,
    region: input.region,
    endpoint: input.endpoint,
    caCertificatePem: input.caCertificatePem,
    additionalFlags: input.additionalFlags,
  });
  return [
    "ls",
    ...configuration.flags,
    "--retries",
    "1",
    "--low-level-retries",
    "1",
    "--timeout",
    "10s",
    "--contimeout",
    "5s",
    `upstand:${input.bucket}`,
  ];
}

export function buildRcloneEnvironment(
  input: Pick<
    TestS3DestinationConnectionInput,
    | "provider"
    | "accessKeyId"
    | "secretAccessKey"
    | "region"
    | "endpoint"
    | "caCertificatePem"
    | "additionalFlags"
  >,
): Record<string, string> {
  return buildRcloneS3Configuration(input).environment;
}

export class TestS3DestinationConnectionUseCase {
  constructor(private readonly uow?: IUnitOfWork) {}

  async execute(
    input: TestS3DestinationConnectionInput,
  ): Promise<{ success: boolean; output?: string }> {
    try {
      let caCertificatePem = input.caCertificatePem;
      if (!caCertificatePem && input.certificateId && this.uow) {
        const cert = await resolveCertificateForOrganization(
          this.uow,
          input.certificateId,
          input.organizationId,
        );
        caCertificatePem = cert?.certificatePem;
      }

      const endpoint = await assertConfiguredHttpUrl(
        input.endpoint,
        (env.UPSTAND_OUTBOUND_ALLOWED_HOSTS ?? "")
          .split(",")
          .map((host) => host.trim())
          .filter(Boolean),
      );
      const { stdout } = await execFileAsync(
        "rclone",
        buildRcloneArguments({
          ...input,
          endpoint: endpoint.toString(),
          caCertificatePem,
        }),
        {
          timeout: 15_000,
          maxBuffer: 1024 * 1024,
          env: {
            ...getInheritedEnv(),
            ...buildRcloneEnvironment({
              ...input,
              endpoint: endpoint.toString(),
              caCertificatePem,
            }),
          },
        },
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
