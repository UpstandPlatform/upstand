import { authorizationService } from "./permissions";

/**
 * The first account is the instance owner created by migration 0015. An
 * explicit environment override is supported for installations that need to
 * transfer ownership without changing tenant memberships.
 */
export async function requireInstanceOwner(
  userId: string,
  actorKind: string | undefined,
): Promise<void> {
  await authorizationService.authorizeInstance({ userId, kind: actorKind });
}

export async function requireInstanceOwnerContext(ctx: {
  session: { user: { id: string } };
  actor?: { kind: string } | null;
}): Promise<void> {
  await requireInstanceOwner(ctx.session.user.id, ctx.actor?.kind);
}
