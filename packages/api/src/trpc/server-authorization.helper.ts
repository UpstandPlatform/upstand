import type { AuthenticatedContext } from "../context";
import { checkPermission, type PermissionAction } from "../permissions";

export async function authorizeServerAccess(
  ctx: AuthenticatedContext,
  organizationId: string,
  permission: PermissionAction,
): Promise<void> {
  await checkPermission(ctx.session.user.id, organizationId, permission);
}
