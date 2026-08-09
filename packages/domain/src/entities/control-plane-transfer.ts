import { z } from "zod";
import { DataOwnershipSchema } from "./deployment-plan";

export const CONTROL_PLANE_TRANSFER_FORMAT_VERSION = 1;

export const PortableControlPlaneTableSchema = z.enum([
  "users",
  "organizations",
  "memberships",
  "credentials",
  "projects",
  "environments",
  "servers",
  "resources",
  "domains",
  "schedules",
  "backups",
  "deployments",
  "settings",
  "audit_history",
]);
export type PortableControlPlaneTable = z.infer<
  typeof PortableControlPlaneTableSchema
>;

export const PORTABLE_TABLE_DEPENDENCY_ORDER =
  PortableControlPlaneTableSchema.options;

const Sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const PortableTableDescriptorSchema = z.object({
  name: PortableControlPlaneTableSchema,
  recordCount: z.number().int().nonnegative(),
  checksum: Sha256Schema,
});

export const PortableSecretBundleDescriptorSchema = z.object({
  algorithm: z.literal("aes-256-gcm"),
  kdf: z.literal("scrypt"),
  cost: z.number().int().min(16_384),
  blockSize: z.number().int().min(8),
  parallelism: z.number().int().min(1),
  keyLength: z.literal(32),
  salt: z.string().min(16),
  nonce: z.string().min(16),
  authTag: z.string().min(16),
  checksum: Sha256Schema,
});

export const ControlPlaneTransferManifestSchema = z
  .object({
    format: z.literal("upstand-control-plane-transfer"),
    formatVersion: z.literal(CONTROL_PLANE_TRANSFER_FORMAT_VERSION),
    schemaVersion: z.string().min(1),
    sourceEngine: z.enum(["postgresql", "pglite"]),
    sourceInstanceId: z.string().min(1),
    sourceOwnership: DataOwnershipSchema,
    createdAt: z.iso.datetime({ offset: true }),
    tables: z.array(PortableTableDescriptorSchema),
    secretBundle: PortableSecretBundleDescriptorSchema.nullable(),
  })
  .strict()
  .superRefine((manifest, context) => {
    let previousIndex = -1;
    const names = new Set<string>();
    for (const [index, table] of manifest.tables.entries()) {
      if (names.has(table.name)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate table descriptor '${table.name}'`,
          path: ["tables", index, "name"],
        });
      }
      names.add(table.name);
      const dependencyIndex = PORTABLE_TABLE_DEPENDENCY_ORDER.indexOf(
        table.name,
      );
      if (dependencyIndex <= previousIndex) {
        context.addIssue({
          code: "custom",
          message: "Tables are not in dependency order",
          path: ["tables", index, "name"],
        });
      }
      previousIndex = dependencyIndex;
    }
  });
export type ControlPlaneTransferManifest = z.infer<
  typeof ControlPlaneTransferManifestSchema
>;

export const PortableControlPlaneRecordSchema = z
  .object({
    table: PortableControlPlaneTableSchema,
    id: z.string().min(1),
    checksum: Sha256Schema,
    data: z.record(z.string(), z.unknown()),
  })
  .strict();
export type PortableControlPlaneRecord = z.infer<
  typeof PortableControlPlaneRecordSchema
>;

const SENSITIVE_KEY =
  /(?:password|secret|token|private.?key|credential|cookie|session)/i;

export function assertPortableRecordRedacted(
  value: unknown,
  path = "data",
): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertPortableRecordRedacted(item, `${path}[${index}]`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      throw new Error(`Sensitive field '${path}.${key}' is not portable`);
    }
    assertPortableRecordRedacted(child, `${path}.${key}`);
  }
}
