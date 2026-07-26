import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES } from "@upstand/domain";
import { ListAuditLogsUseCaseToken } from "@upstand/usecases/tokens";
import { z } from "zod";
import { protectedProcedure, router } from "../index";
import { checkPermission } from "../permissions";

const inputSchema = z.object({
  organizationId: z.string().min(1),
  actorId: z.string().min(1).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  resourceType: z.enum(AUDIT_RESOURCE_TYPES).optional(),
  search: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});

export const auditLogRouter = router({
  list: protectedProcedure.input(inputSchema).query(async ({ ctx, input }) => {
    await checkPermission(
      ctx.session.user.id,
      input.organizationId,
      "audit_log:view",
    );
    return ctx.scope.resolve(ListAuditLogsUseCaseToken).execute({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      search: input.search,
      from: input.from,
      to: input.to,
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    });
  }),
});
