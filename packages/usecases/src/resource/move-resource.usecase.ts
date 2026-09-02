import {
  type IUnitOfWork,
  parseDomainMappings,
  type Resource,
  serializeDomainMappings,
  ValidationError,
} from "@upstand/domain";
import { z } from "zod";
import { requiresRemoteServerPlacement } from "../platform/platform.types";
import {
  parseResourceCredentials,
  parseResourceCredentialsStrict,
  serializeResourceCredentials,
} from "./resource-credentials";
import { validateResourceCredentialReferences } from "./validate-resource-credential-references";

const OptionalMappingIdSchema = z.string().min(1).nullable().optional();

export const MoveResourceInputSchema = z.object({
  resourceId: z.string().min(1, "Resource ID is required"),
  sourceOrganizationId: z.string().min(1, "Source organization ID is required"),
  targetProjectId: z.string().min(1, "Target project ID is required"),
  targetEnvironmentId: z.string().min(1, "Target environment ID is required"),
  targetServerId: OptionalMappingIdSchema,
  targetBuildServerId: OptionalMappingIdSchema,
  targetBuildRegistryId: OptionalMappingIdSchema,
  targetRollbackRegistryId: OptionalMappingIdSchema,
  targetRegistryId: OptionalMappingIdSchema,
  targetGitProviderId: OptionalMappingIdSchema,
  targetSshKeyId: OptionalMappingIdSchema,
  targetCertificateIds: z
    .record(z.string().min(1), z.string().min(1))
    .optional(),
});

export type MoveResourceInput = z.infer<typeof MoveResourceInputSchema>;

export type MoveResourceResult = {
  resource: Resource;
  sourceProjectId: string;
  targetProjectId: string;
  sourceOrganizationId: string;
  targetOrganizationId: string;
};

/** Move only the control-plane ownership of a resource; live workload state is preserved. */
export class MoveResourceUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: MoveResourceInput): Promise<MoveResourceResult> {
    return this.uow.transaction(async (tx) => {
      await tx.resourceRepository.lockById(input.resourceId);
      const resource = await tx.resourceRepository.findById(input.resourceId);
      if (!resource) throw new ValidationError("Resource not found");

      const sourceEnvironment = await tx.environmentRepository.findById(
        resource.environmentId,
      );
      const sourceProject = sourceEnvironment
        ? await tx.projectRepository.findById(sourceEnvironment.projectId)
        : null;
      const targetProject = await tx.projectRepository.findById(
        input.targetProjectId,
      );
      const targetEnvironment = await tx.environmentRepository.findById(
        input.targetEnvironmentId,
      );
      if (
        !sourceEnvironment ||
        !sourceProject ||
        sourceProject.organizationId !== input.sourceOrganizationId
      ) {
        throw new ValidationError("Resource not found");
      }
      if (!targetProject || targetProject.archivedAt) {
        throw new ValidationError("Target project is not available");
      }
      if (
        !targetEnvironment ||
        targetEnvironment.projectId !== targetProject.id
      ) {
        throw new ValidationError(
          "Target environment is not part of the target project",
        );
      }
      if (sourceEnvironment.id === targetEnvironment.id) {
        throw new ValidationError(
          "Resource is already in the target environment",
        );
      }

      const crossOrganization =
        sourceProject.organizationId !== targetProject.organizationId;
      const mapped = (
        value: string | null | undefined,
        target: string | null | undefined,
        label: string,
      ) => {
        const globalReference = value === "local" || value === "manager";
        if (!crossOrganization || !value || globalReference)
          return target === undefined ? value : target;
        if (!target)
          throw new ValidationError(
            `${label} must be mapped when moving between organizations`,
          );
        return target;
      };

      const serverId = mapped(
        resource.serverId,
        input.targetServerId,
        "Deployment server",
      );
      const buildServerId = mapped(
        resource.buildServerId,
        input.targetBuildServerId,
        "Build server",
      );
      const buildRegistryId = mapped(
        resource.buildRegistryId,
        input.targetBuildRegistryId,
        "Build registry",
      );
      const rollbackRegistryId = mapped(
        resource.rollbackRegistryId,
        input.targetRollbackRegistryId,
        "Rollback registry",
      );

      const activeMigrations =
        await tx.workloadMigrationRepository.findByResourceId(resource.id, 20);
      if (
        activeMigrations.some(
          (migration) =>
            !["completed", "failed", "cancelled"].includes(migration.status),
        )
      ) {
        throw new ValidationError("Resource has an active workload migration");
      }
      if (requiresRemoteServerPlacement() && !serverId) {
        throw new ValidationError(
          "Cloud resources must remain assigned to a deployment server",
        );
      }

      await validateServer(
        tx,
        serverId,
        targetProject.organizationId,
        "Deployment server",
      );
      await validateServer(
        tx,
        buildServerId,
        targetProject.organizationId,
        "Build server",
      );
      await validateRegistry(
        tx,
        buildRegistryId,
        targetProject.organizationId,
        "Build registry",
      );
      await validateRegistry(
        tx,
        rollbackRegistryId,
        targetProject.organizationId,
        "Rollback registry",
      );

      let credentials = resource.credentials;
      let credentialValues = parseResourceCredentials(resource.credentials);
      if (crossOrganization) {
        try {
          credentialValues = parseResourceCredentialsStrict(
            resource.credentials,
          );
        } catch {
          throw new ValidationError(
            "Resource credentials are invalid and cannot be moved",
          );
        }
        if (typeof credentialValues.registryId === "string") {
          if (!input.targetRegistryId) {
            throw new ValidationError(
              "Application registry must be mapped when moving between organizations",
            );
          }
          credentialValues.registryId = input.targetRegistryId;
        }
        if (typeof credentialValues.githubAccount === "string") {
          if (!input.targetGitProviderId) {
            throw new ValidationError(
              "Git provider must be mapped when moving between organizations",
            );
          }
          credentialValues.githubAccount = input.targetGitProviderId;
        }
        if (typeof credentialValues.sshKeyId === "string") {
          if (!input.targetSshKeyId) {
            throw new ValidationError(
              "SSH key must be mapped when moving between organizations",
            );
          }
          credentialValues.sshKeyId = input.targetSshKeyId;
        }
        credentials = serializeResourceCredentials(credentialValues);
      }
      await validateRegistry(
        tx,
        typeof credentialValues.registryId === "string"
          ? credentialValues.registryId
          : null,
        targetProject.organizationId,
        "Application registry",
      );
      await validateResourceCredentialReferences(
        tx,
        targetProject.organizationId,
        credentials,
      );

      let domains = resource.domains;
      if (crossOrganization) {
        const mappings = parseDomainMappings(resource.domains);
        const certificateIds = new Set(
          mappings
            .filter((mapping) => mapping.certificateType === "custom")
            .map((mapping) => mapping.certificateId)
            .filter((id): id is string => Boolean(id)),
        );
        const replacements = input.targetCertificateIds ?? {};
        for (const certificateId of certificateIds) {
          const replacement = replacements[certificateId];
          if (!replacement) {
            throw new ValidationError(
              "Custom certificates must be mapped when moving between organizations",
            );
          }
          const certificate =
            await tx.certificateRepository.findById(replacement);
          if (
            !certificate ||
            certificate.organizationId !== targetProject.organizationId
          ) {
            throw new ValidationError(
              "Selected target certificate is not available to the target organization",
            );
          }
        }
        domains = serializeDomainMappings(
          mappings.map((mapping) =>
            mapping.certificateId && replacements[mapping.certificateId]
              ? {
                  ...mapping,
                  certificateId: replacements[mapping.certificateId],
                }
              : mapping,
          ),
        );
      }

      const updated = await tx.resourceRepository.updateById(resource.id, {
        environmentId: targetEnvironment.id,
        serverId: serverId ?? null,
        buildServerId: buildServerId ?? null,
        buildRegistryId: buildRegistryId ?? null,
        rollbackRegistryId: rollbackRegistryId ?? null,
        credentials,
        domains,
      });
      if (!updated)
        throw new ValidationError("Resource move could not be completed");

      await tx.environmentRepository.incrementResourceCount(
        sourceEnvironment.id,
        -1,
      );
      await tx.environmentRepository.incrementResourceCount(
        targetEnvironment.id,
        1,
      );

      return {
        resource: updated,
        sourceProjectId: sourceProject.id,
        targetProjectId: targetProject.id,
        sourceOrganizationId: sourceProject.organizationId,
        targetOrganizationId: targetProject.organizationId,
      };
    });
  }
}

async function validateServer(
  tx: IUnitOfWork,
  serverId: string | null | undefined,
  organizationId: string,
  label: string,
): Promise<void> {
  if (!serverId || serverId === "local" || serverId === "manager") return;
  const server = await tx.serverRepository.findById(serverId);
  if (!server || server.organizationId !== organizationId) {
    throw new ValidationError(
      `${label} is not available to the target organization`,
    );
  }
}

async function validateRegistry(
  tx: IUnitOfWork,
  registryId: string | null | undefined,
  organizationId: string,
  label: string,
): Promise<void> {
  if (!registryId) return;
  const registry = await tx.dockerRegistryRepository.findById(registryId);
  if (!registry || registry.organizationId !== organizationId) {
    throw new ValidationError(
      `${label} is not available to the target organization`,
    );
  }
}
