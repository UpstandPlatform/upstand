import { AsyncLocalStorage } from "node:async_hooks";
import { TRPCError } from "@trpc/server";
import { db } from "@upstand/db";
import { member } from "@upstand/db/schema/auth";
import { and, eq } from "drizzle-orm";

type Membership = typeof member.$inferSelect;
const organizationAccessStorage = new AsyncLocalStorage<
  Map<string, Promise<Membership | undefined>>
>();

export function withOrganizationAccessCache<T>(
  work: () => Promise<T>,
): Promise<T> {
  return organizationAccessStorage.run(new Map(), work);
}

export async function ensureOrganizationAccess(
  userId: string,
  organizationId: string,
  allowedRoles?: string[],
) {
  const cache = organizationAccessStorage.getStore();
  const key = `${userId}:${organizationId}`;
  let membershipPromise = cache?.get(key);
  if (!membershipPromise) {
    membershipPromise = db
      .select()
      .from(member)
      .where(
        and(
          eq(member.userId, userId),
          eq(member.organizationId, organizationId),
          eq(member.scimActive, true),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);
    cache?.set(key, membershipPromise);
  }
  const membership = await membershipPromise;

  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this organization",
    });
  }

  if (allowedRoles && !allowedRoles.includes(membership.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Required role not met. Allowed roles: ${allowedRoles.join(", ")}`,
    });
  }

  return membership;
}
