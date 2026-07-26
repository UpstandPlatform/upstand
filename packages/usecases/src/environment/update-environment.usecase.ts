import type { Environment, IUnitOfWork } from "@upstand/domain";
import { ValidationError } from "@upstand/domain";
import { z } from "zod";
import {
  parseResourceEnvironmentVariables,
  ResourceEnvironmentVariablesSchema,
  serializeResourceEnvironmentVariables,
} from "../resource/resource-environment";

export const UpdateEnvironmentInputSchema = z.object({
  id: z.string().min(1, "Environment ID is required"),
  name: z.string().min(1, "Name must not be empty").max(255).optional(),
  description: z.string().max(1024).nullable().optional(),
  parentEnvironmentId: z.string().min(1).nullable().optional(),
  inheritsVariables: z.boolean().optional(),
  /**
   * Plain key/value map of project-level environment variables.
   * The use case encrypts and serialises the map before persisting.
   */
  envVars: ResourceEnvironmentVariablesSchema.optional(),
});

export type UpdateEnvironmentInput = z.infer<
  typeof UpdateEnvironmentInputSchema
>;

export class UpdateEnvironmentUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: UpdateEnvironmentInput): Promise<Environment> {
    return this.uow.transaction(async (tx) => {
      const existing = await tx.environmentRepository.findById(input.id);
      if (!existing) {
        throw new ValidationError("Environment not found.");
      }

      const patch: Parameters<
        typeof tx.environmentRepository.updateEnvironment
      >[1] = {};

      if (input.name !== undefined) {
        patch.name = input.name;
      }
      if (input.description !== undefined) {
        patch.description = input.description;
      }
      if (input.parentEnvironmentId !== undefined) {
        if (input.parentEnvironmentId === input.id) {
          throw new ValidationError(
            "An environment cannot inherit from itself.",
          );
        }
        const ancestors =
          input.parentEnvironmentId && tx.environmentRepository.findAncestors
            ? await tx.environmentRepository.findAncestors(
                input.parentEnvironmentId,
              )
            : [];
        if (ancestors.some((environment) => environment.id === input.id)) {
          throw new ValidationError(
            "Environment inheritance cannot contain a cycle.",
          );
        }
        patch.parentEnvironmentId = input.parentEnvironmentId;
      }
      if (input.inheritsVariables !== undefined) {
        patch.inheritsVariables = input.inheritsVariables;
      }
      if (input.envVars !== undefined) {
        patch.envVars = serializeResourceEnvironmentVariables(input.envVars);
      }

      const updated = await tx.environmentRepository.updateEnvironment(
        input.id,
        patch,
      );

      if (!updated) {
        throw new ValidationError("Environment not found after update.");
      }

      return updated;
    });
  }
}

export async function resolveEnvironmentVariables(
  uow: IUnitOfWork,
  environmentId: string,
): Promise<Record<string, string>> {
  const chain = uow.environmentRepository.findAncestors
    ? await uow.environmentRepository.findAncestors(environmentId)
    : [await uow.environmentRepository.findById(environmentId)].filter(
        (environment): environment is NonNullable<typeof environment> =>
          Boolean(environment),
      );
  const resolved: Record<string, string> = {};
  let includeParent = true;
  for (const environment of chain) {
    if (!includeParent && environment.id !== environmentId) break;
    Object.assign(
      resolved,
      parseResourceEnvironmentVariables(environment.envVars),
    );
    includeParent = environment.inheritsVariables;
  }
  return resolved;
}
