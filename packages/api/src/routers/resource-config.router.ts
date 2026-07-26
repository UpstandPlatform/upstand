import { TRPCError } from "@trpc/server";
import {
  parseResourceAdvancedConfig,
  type Resource,
  ResourcePortSchema,
  ResourceVolumeSchema,
} from "@upstand/domain";
import { UpdateResourceUseCaseToken } from "@upstand/usecases/tokens";
import { z } from "zod";
import type { AuthenticatedContext } from "../context";
import { router, twoFactorVerifiedProcedure } from "../index";
import { authorizeResource } from "./shared/resource-authorization";

const ResourceIndexInputSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().min(0).max(31),
});

const PortCreateInputSchema = z.object({
  id: z.string().min(1),
  port: ResourcePortSchema,
});
const PortUpdateInputSchema = ResourceIndexInputSchema.extend({
  port: ResourcePortSchema,
});
const VolumeCreateInputSchema = z.object({
  id: z.string().min(1),
  volume: ResourceVolumeSchema,
});
const VolumeUpdateInputSchema = ResourceIndexInputSchema.extend({
  volume: ResourceVolumeSchema,
});
const ResourceIdInputSchema = z.object({ id: z.string().min(1) });

function authorize(
  ctx: AuthenticatedContext,
  id: string,
  action: "view" | "update",
) {
  return authorizeResource(ctx, id, {
    action: `resource:${action}`,
    missingProjectMessage: "Environment not found",
  });
}

async function updateConfig(
  ctx: AuthenticatedContext,
  resource: Resource,
  config: ReturnType<typeof parseResourceAdvancedConfig>,
) {
  const updated = await ctx.scope.resolve(UpdateResourceUseCaseToken).execute({
    id: resource.id,
    advancedConfig: JSON.stringify(config),
  });
  if (!updated)
    throw new TRPCError({ code: "NOT_FOUND", message: "Resource not found" });
  return parseResourceAdvancedConfig(updated.advancedConfig);
}

export const portRouter = router({
  list: twoFactorVerifiedProcedure
    .input(ResourceIdInputSchema)
    .query(async ({ ctx, input }) => {
      const resource = await authorize(ctx, input.id, "view");
      return parseResourceAdvancedConfig(resource.advancedConfig).ports;
    }),
  create: twoFactorVerifiedProcedure
    .input(PortCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const resource = await authorize(ctx, input.id, "update");
      const config = parseResourceAdvancedConfig(resource.advancedConfig);
      const conflict = config.ports.some(
        (port) =>
          port.publishedPort === input.port.publishedPort &&
          port.protocol === input.port.protocol,
      );
      if (conflict)
        throw new TRPCError({
          code: "CONFLICT",
          message: `Host published port ${input.port.publishedPort}/${input.port.protocol} is already allocated in this resource`,
        });
      config.ports = [...config.ports, input.port];
      return updateConfig(ctx, resource, config).then(
        (updated) => updated.ports,
      );
    }),
  update: twoFactorVerifiedProcedure
    .input(PortUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const resource = await authorize(ctx, input.id, "update");
      const config = parseResourceAdvancedConfig(resource.advancedConfig);
      if (!config.ports[input.index])
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Port mapping not found",
        });
      const conflict = config.ports.some(
        (port, idx) =>
          idx !== input.index &&
          port.publishedPort === input.port.publishedPort &&
          port.protocol === input.port.protocol,
      );
      if (conflict)
        throw new TRPCError({
          code: "CONFLICT",
          message: `Host published port ${input.port.publishedPort}/${input.port.protocol} is already allocated in this resource`,
        });
      config.ports[input.index] = input.port;
      return updateConfig(ctx, resource, config).then(
        (updated) => updated.ports,
      );
    }),
  delete: twoFactorVerifiedProcedure
    .input(ResourceIndexInputSchema)
    .mutation(async ({ ctx, input }) => {
      const resource = await authorize(ctx, input.id, "update");
      const config = parseResourceAdvancedConfig(resource.advancedConfig);
      if (!config.ports[input.index])
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Port mapping not found",
        });
      config.ports = config.ports.filter((_, index) => index !== input.index);
      return updateConfig(ctx, resource, config).then(
        (updated) => updated.ports,
      );
    }),
});

export const mountRouter = router({
  list: twoFactorVerifiedProcedure
    .input(ResourceIdInputSchema)
    .query(async ({ ctx, input }) => {
      const resource = await authorize(ctx, input.id, "view");
      return parseResourceAdvancedConfig(resource.advancedConfig).volumes;
    }),
  create: twoFactorVerifiedProcedure
    .input(VolumeCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const resource = await authorize(ctx, input.id, "update");
      const config = parseResourceAdvancedConfig(resource.advancedConfig);
      if (
        config.volumes.some((volume) => volume.target === input.volume.target)
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This mount target already exists",
        });
      }
      config.volumes = [...config.volumes, input.volume];
      return updateConfig(ctx, resource, config).then(
        (updated) => updated.volumes,
      );
    }),
  update: twoFactorVerifiedProcedure
    .input(VolumeUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const resource = await authorize(ctx, input.id, "update");
      const config = parseResourceAdvancedConfig(resource.advancedConfig);
      if (!config.volumes[input.index])
        throw new TRPCError({ code: "NOT_FOUND", message: "Mount not found" });
      config.volumes[input.index] = input.volume;
      return updateConfig(ctx, resource, config).then(
        (updated) => updated.volumes,
      );
    }),
  delete: twoFactorVerifiedProcedure
    .input(ResourceIndexInputSchema)
    .mutation(async ({ ctx, input }) => {
      const resource = await authorize(ctx, input.id, "update");
      const config = parseResourceAdvancedConfig(resource.advancedConfig);
      if (!config.volumes[input.index])
        throw new TRPCError({ code: "NOT_FOUND", message: "Mount not found" });
      config.volumes = config.volumes.filter(
        (_, index) => index !== input.index,
      );
      return updateConfig(ctx, resource, config).then(
        (updated) => updated.volumes,
      );
    }),
});
