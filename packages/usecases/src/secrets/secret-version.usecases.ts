import { randomBytes, randomUUID } from "node:crypto";
import type {
  IUnitOfWork,
  SecretProviderConfiguration,
  SecretScopeType,
  SecretVersion,
  SecretVersionPayload,
} from "@upstand/domain";
import {
  decryptSecret,
  encryptSecret,
} from "@upstand/platform/crypto/secret-box";
import { z } from "zod";
import { QueueDeploymentUseCase } from "../deployment/queue-deployment.usecase";
import type { ExternalSecretProviderPort } from "../ports/external-secrets";
import {
  parseResourceEnvironmentVariables,
  serializeResourceEnvironmentVariables,
} from "../resource/resource-environment";

export const ListSecretVersionsInputSchema = z.object({
  scopeType: z.enum(["environment", "resource"]),
  scopeId: z.string().min(1),
});
export const RestoreSecretVersionInputSchema = z.object({
  scopeType: z.enum(["environment", "resource"]),
  scopeId: z.string().min(1),
  version: z.number().int().positive(),
});
export const CreateSecretProviderInputSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  provider: z.enum(["vault", "aws-secrets-manager", "onepassword"]),
  configuration: z.record(z.string(), z.string()).default({}),
});
export const UpdateSecretProviderInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  configuration: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});
export const TestSecretProviderConnectionInputSchema = z.object({
  organizationId: z.string().min(1),
  provider: z.enum(["vault", "aws-secrets-manager", "onepassword"]),
  configuration: z.record(z.string(), z.string()).default({}),
});
export const SyncSecretProviderInputSchema = z.object({
  providerId: z.string().min(1),
  scopeType: z.enum(["environment", "resource"]),
  scopeId: z.string().min(1),
  merge: z.boolean().default(true),
});
export const RotateSecretsInputSchema = z.object({
  scopeType: z.enum(["environment", "resource"]),
  scopeId: z.string().min(1),
  keys: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    )
    .min(1)
    .max(100),
  length: z.number().int().min(16).max(128).default(32),
});
export const CreateSecretRotationScheduleInputSchema = z.object({
  organizationId: z.string().min(1),
  scopeType: z.enum(["environment", "resource"]),
  scopeId: z.string().min(1),
  keys: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    )
    .min(1)
    .max(100),
  intervalHours: z.number().int().min(1).max(8760),
  valueLength: z.number().int().min(16).max(128).default(32),
  enabled: z.boolean().default(true),
});
export const UpdateSecretRotationScheduleInputSchema = z.object({
  id: z.string().min(1),
  keys: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    )
    .min(1)
    .max(100)
    .optional(),
  intervalHours: z.number().int().min(1).max(8760).optional(),
  valueLength: z.number().int().min(16).max(128).optional(),
  enabled: z.boolean().optional(),
});

type RotateSecretsInput = z.infer<typeof RotateSecretsInputSchema>;
type AuthorizedSecretScopeInput = {
  organizationId: string;
};

async function enqueueSecretScopeDeployments(
  uow: IUnitOfWork,
  scopeType: SecretScopeType,
  scopeId: string,
  title: string,
): Promise<void> {
  const resourceIds =
    scopeType === "resource"
      ? [scopeId]
      : (await uow.resourceRepository.findByEnvironmentId(scopeId)).map(
          (resource) => resource.id,
        );
  const queueDeployment = new QueueDeploymentUseCase(uow);
  for (const resourceId of resourceIds) {
    await queueDeployment.execute({ resourceId, title });
  }
}

function decryptConfiguration(value: string): SecretProviderConfiguration {
  try {
    const payload = JSON.parse(value) as {
      ciphertext: string;
      iv: string;
      authTag: string;
      keyVersion: number;
    };
    return JSON.parse(decryptSecret(payload)) as SecretProviderConfiguration;
  } catch {
    return {};
  }
}

async function rotateSecretScope(
  uow: IUnitOfWork,
  input: RotateSecretsInput,
): Promise<{ rotatedKeys: string[]; values: Record<string, string> }> {
  const current =
    input.scopeType === "environment"
      ? await uow.environmentRepository.findById(input.scopeId)
      : await uow.resourceRepository.findById(input.scopeId);
  if (!current) throw new Error("Secret scope not found");
  const values = parseResourceEnvironmentVariables(current.envVars);
  const rotated: Record<string, string> = {};
  for (const key of input.keys) {
    const value = randomBytes(Math.ceil(input.length * 0.75))
      .toString("base64url")
      .slice(0, input.length);
    values[key] = value;
    rotated[key] = value;
  }
  const envVars = serializeResourceEnvironmentVariables(values);
  if (input.scopeType === "environment") {
    await uow.environmentRepository.updateEnvironment(input.scopeId, {
      envVars,
    });
  } else {
    await uow.resourceRepository.updateById(input.scopeId, { envVars });
  }
  return { rotatedKeys: input.keys, values: rotated };
}

export class ListSecretVersionsUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  execute(
    input: z.infer<typeof ListSecretVersionsInputSchema> &
      AuthorizedSecretScopeInput,
  ): Promise<SecretVersion[]> {
    return this.uow.secretVersionRepository.findByScope(
      input.scopeType,
      input.scopeId,
      input.organizationId,
    );
  }
}

export class GetSecretVersionUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  execute(
    input: z.infer<typeof RestoreSecretVersionInputSchema> &
      AuthorizedSecretScopeInput,
  ): Promise<SecretVersionPayload | null> {
    return this.uow.secretVersionRepository.findByScopeVersion(
      input.scopeType,
      input.scopeId,
      input.version,
      input.organizationId,
    );
  }
}

export class RestoreSecretVersionUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  async execute(
    input: z.infer<typeof RestoreSecretVersionInputSchema> &
      AuthorizedSecretScopeInput,
  ): Promise<void> {
    const payload = await this.uow.secretVersionRepository.findByScopeVersion(
      input.scopeType,
      input.scopeId,
      input.version,
      input.organizationId,
    );
    if (!payload) throw new Error("Secret version not found");
    if (input.scopeType === "environment") {
      await this.uow.environmentRepository.updateEnvironment(input.scopeId, {
        envVars: payload.envVars,
      });
    } else {
      const restored = await this.uow.resourceRepository.updateById(
        input.scopeId,
        {
          credentials: payload.credentials,
          buildSecrets: payload.buildSecrets,
          buildEnvVars: payload.buildEnvVars,
          envVars: payload.envVars,
        },
      );
      if (!restored) throw new Error("Resource not found");
    }
    await enqueueSecretScopeDeployments(
      this.uow,
      input.scopeType,
      input.scopeId,
      "Restore secret version",
    );
  }
}

export class CreateSecretProviderUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  async execute(input: z.infer<typeof CreateSecretProviderInputSchema>) {
    return this.uow.secretProviderRepository.create({
      id: randomUUID(),
      organizationId: input.organizationId,
      name: input.name,
      provider: input.provider,
      encryptedConfiguration: JSON.stringify(
        encryptSecret(JSON.stringify(input.configuration)),
      ),
    });
  }
}

export class ListSecretProvidersUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  execute(organizationId: string) {
    return this.uow.secretProviderRepository.findByOrganizationId(
      organizationId,
    );
  }
}

export class DeleteSecretProviderUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  execute(id: string) {
    return this.uow.secretProviderRepository.deleteById(id);
  }
}

export class UpdateSecretProviderUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  async execute(input: z.infer<typeof UpdateSecretProviderInputSchema>) {
    const current = await this.uow.secretProviderRepository.findById(input.id);
    if (!current) throw new Error("Secret provider not found");
    const configuration =
      input.configuration === undefined
        ? undefined
        : JSON.stringify(encryptSecret(JSON.stringify(input.configuration)));
    return this.uow.secretProviderRepository.updateById(input.id, {
      name: input.name,
      encryptedConfiguration: configuration,
      enabled: input.enabled,
    });
  }
}

export class SyncSecretProviderUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly external: ExternalSecretProviderPort,
  ) {}
  async execute(
    input: z.infer<typeof SyncSecretProviderInputSchema> & {
      organizationId: string;
    },
  ): Promise<{ syncedKeys: string[] }> {
    const stored =
      await this.uow.secretProviderRepository.findEnabledConfiguration(
        input.providerId,
        input.organizationId,
      );
    if (!stored) throw new Error("Secret provider not found or disabled");
    const values = await this.external.read(
      stored.provider,
      decryptConfiguration(stored.encryptedConfiguration),
    );
    await this.apply(input.scopeType, input.scopeId, values, input.merge);
    return { syncedKeys: Object.keys(values).sort() };
  }

  private async apply(
    scopeType: SecretScopeType,
    scopeId: string,
    values: Record<string, string>,
    merge: boolean,
  ): Promise<void> {
    let merged: Record<string, string>;
    if (scopeType === "environment") {
      const current = await this.uow.environmentRepository.findById(scopeId);
      if (!current) throw new Error("Environment not found");
      merged = merge
        ? { ...parseResourceEnvironmentVariables(current.envVars), ...values }
        : values;
      await this.uow.environmentRepository.updateEnvironment(scopeId, {
        envVars: serializeResourceEnvironmentVariables(merged),
      });
    } else {
      const current = await this.uow.resourceRepository.findById(scopeId);
      if (!current) throw new Error("Resource not found");
      merged = merge
        ? { ...parseResourceEnvironmentVariables(current.envVars), ...values }
        : values;
      await this.uow.resourceRepository.updateById(scopeId, {
        envVars: serializeResourceEnvironmentVariables(merged),
      });
    }
    await enqueueSecretScopeDeployments(
      this.uow,
      scopeType,
      scopeId,
      "Sync external secrets",
    );
  }
}

export class TestSecretProviderConnectionUseCase {
  constructor(private readonly external: ExternalSecretProviderPort) {}
  execute(input: z.infer<typeof TestSecretProviderConnectionInputSchema>) {
    if (!this.external.testConnection) {
      return Promise.resolve({
        success: true,
        message: "Secret provider connection test is unavailable.",
      });
    }
    return this.external.testConnection(input.provider, input.configuration);
  }
}

export class RotateSecretsUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(
    input: RotateSecretsInput,
  ): Promise<{ rotatedKeys: string[]; values: Record<string, string> }> {
    const result = await rotateSecretScope(this.uow, input);
    await enqueueSecretScopeDeployments(
      this.uow,
      input.scopeType,
      input.scopeId,
      "Rotate secrets",
    );
    return result;
  }
}

export class CreateSecretRotationScheduleUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  async execute(
    input: z.infer<typeof CreateSecretRotationScheduleInputSchema>,
  ) {
    if (!this.uow.secretRotationScheduleRepository)
      throw new Error("Secret rotation scheduling is unavailable");
    const scope =
      input.scopeType === "environment"
        ? await this.uow.environmentRepository.findById(input.scopeId)
        : await this.uow.resourceRepository.findById(input.scopeId);
    if (!scope) throw new Error("Secret scope not found");
    return this.uow.secretRotationScheduleRepository.create({
      id: randomUUID(),
      ...input,
    });
  }
}

export class ListSecretRotationSchedulesUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  execute(scopeType: "environment" | "resource", scopeId: string) {
    if (!this.uow.secretRotationScheduleRepository)
      throw new Error("Secret rotation scheduling is unavailable");
    return this.uow.secretRotationScheduleRepository.findByScope(
      scopeType,
      scopeId,
    );
  }
}

export class UpdateSecretRotationScheduleUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  async execute(
    input: z.infer<typeof UpdateSecretRotationScheduleInputSchema>,
  ) {
    if (!this.uow.secretRotationScheduleRepository)
      throw new Error("Secret rotation scheduling is unavailable");
    const updated = await this.uow.secretRotationScheduleRepository.updateById(
      input.id,
      input,
    );
    if (!updated) throw new Error("Secret rotation schedule not found");
    return updated;
  }
}

export class DeleteSecretRotationScheduleUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  async execute(id: string) {
    if (!this.uow.secretRotationScheduleRepository)
      throw new Error("Secret rotation scheduling is unavailable");
    if (!(await this.uow.secretRotationScheduleRepository.deleteById(id)))
      throw new Error("Secret rotation schedule not found");
    return { success: true };
  }
}

export class RunDueSecretRotationsUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  async execute(now = new Date()): Promise<number> {
    const repository = this.uow.secretRotationScheduleRepository;
    if (!repository) return 0;
    const schedules = await repository.findDue(now);
    let rotated = 0;
    for (const schedule of schedules) {
      const claimed = await repository.claimDue(
        schedule.id,
        now,
        new Date(now.getTime() + 60 * 60 * 1_000),
      );
      if (!claimed) continue;
      try {
        await rotateSecretScope(this.uow, {
          scopeType: claimed.scopeType,
          scopeId: claimed.scopeId,
          keys: claimed.keys,
          length: claimed.valueLength,
        });
        await enqueueSecretScopeDeployments(
          this.uow,
          claimed.scopeType,
          claimed.scopeId,
          "Automatic secret rotation",
        );
        await repository.updateById(claimed.id, {
          lastRotatedAt: now,
          rotationClaimedUntil: null,
        });
        rotated += 1;
      } catch {
        // One invalid/deleted scope must not prevent unrelated schedules from rotating.
        await repository.updateById(claimed.id, { rotationClaimedUntil: null });
      }
    }
    return rotated;
  }
}
