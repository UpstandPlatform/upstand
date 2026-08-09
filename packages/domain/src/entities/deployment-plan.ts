import { z } from "zod";
import { ApplicationBuildConfigSchema } from "./resource";

export const DeployTargetSchema = z.enum(["local", "remote-server", "cloud"]);
export type DeployTarget = z.infer<typeof DeployTargetSchema>;

export const ExecutionRuntimeSchema = z.enum([
  "docker",
  "bare-process",
  "cloud",
]);
export type ExecutionRuntime = z.infer<typeof ExecutionRuntimeSchema>;

export const BuildLocationSchema = z.enum([
  "control-plane",
  "target",
  "remote-builder",
  "cloud",
]);
export type BuildLocation = z.infer<typeof BuildLocationSchema>;

export const DataOwnershipSchema = z.enum([
  "local-control-plane",
  "cloud-control-plane",
]);
export type DataOwnership = z.infer<typeof DataOwnershipSchema>;

export const DeploymentTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local") }).readonly(),
  z
    .object({
      kind: z.literal("remote-server"),
      serverId: z.string().min(1),
    })
    .readonly(),
  z
    .object({
      kind: z.literal("cloud"),
      cloudProjectId: z.string().min(1),
    })
    .readonly(),
]);

export const DeploymentBuildLocationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("control-plane") }).readonly(),
  z.object({ kind: z.literal("target") }).readonly(),
  z
    .object({
      kind: z.literal("remote-builder"),
      serverId: z.string().min(1),
    })
    .readonly(),
  z.object({ kind: z.literal("cloud") }).readonly(),
]);

export const ArtifactIdentitySchema = z
  .object({
    digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    reference: z.string().min(1),
    provenanceDigest: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/)
      .nullable()
      .default(null),
    sbomDigest: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/)
      .nullable()
      .default(null),
  })
  .readonly();
export type ArtifactIdentity = z.infer<typeof ArtifactIdentitySchema>;

export const DeploymentPlanSchema = z
  .object({
    version: z.literal(1),
    target: DeploymentTargetSchema,
    runtime: ExecutionRuntimeSchema,
    buildLocation: DeploymentBuildLocationSchema,
    ownership: DataOwnershipSchema,
    sourceRevision: z.string().min(1),
    configurationVersion: z.string().min(1),
    buildConfig: ApplicationBuildConfigSchema.readonly(),
    detectorVersion: z.string().min(1).nullable(),
    artifact: ArtifactIdentitySchema,
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .readonly();

export type DeploymentPlan = z.infer<typeof DeploymentPlanSchema>;

export function serializeDeploymentPlan(plan: DeploymentPlan): string {
  return JSON.stringify(DeploymentPlanSchema.parse(plan));
}

export function parseDeploymentPlan(input: unknown): DeploymentPlan | null {
  if (input == null || input === "") return null;
  try {
    const value = typeof input === "string" ? JSON.parse(input) : input;
    return DeploymentPlanSchema.parse(value);
  } catch {
    return null;
  }
}
