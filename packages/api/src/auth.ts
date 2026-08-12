import { randomUUID } from "node:crypto";
import { type AuthCallbacks, createAuth } from "@upstand/auth";
import { createStepUpAuth } from "@upstand/auth/step-up-auth";
import { db } from "@upstand/db";
import * as authSchema from "@upstand/db/schema/auth";
import { backupRun, backupSchedule } from "@upstand/db/schema/backup";
import { notificationChannel } from "@upstand/db/schema/notification";
import { NotificationChannelSchema } from "@upstand/domain";
import { env } from "@upstand/env/server";
import { NotificationTransportRegistry } from "@upstand/infrastructure";
import { redis, withRedisTimeout } from "@upstand/redis";
import {
  decryptNotificationConfiguration,
  getConfiguredControlPlaneMode,
} from "@upstand/usecases";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, count, eq, gt, sql } from "drizzle-orm";

export const notificationTransport = new NotificationTransportRegistry();

const stepUp = createStepUpAuth({
  get: (key) => withRedisTimeout(redis.get(key)),
  set: (key, value, mode, ttl) =>
    withRedisTimeout(redis.set(key, value, mode, ttl)),
  del: (key) => withRedisTimeout(redis.del(key)),
});

const secondaryStorage = {
  get: async (key: string) => (await withRedisTimeout(redis.get(key))) || null,
  set: async (key: string, value: string, ttl?: number) => {
    if (ttl) await withRedisTimeout(redis.set(key, value, "EX", ttl));
    else await withRedisTimeout(redis.set(key, value));
  },
  // Better Auth uses increment for its distributed rate limiter when it is
  // available. Keep the increment and first-write expiry in one Redis script
  // so concurrent API instances cannot bypass the limit or create immortal
  // counters.
  increment: async (key: string, ttl: number) => {
    const result = await withRedisTimeout(
      redis.eval(
        "local value = redis.call('INCR', KEYS[1]); if value == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return value",
        1,
        key,
        String(Math.max(1, Math.ceil(ttl))),
      ),
    );
    return Number(result);
  },
  delete: (key: string) =>
    withRedisTimeout(redis.del(key)).then(() => undefined),
};

const callbacks: AuthCallbacks = {
  async createPersonalOrganization(user) {
    const organizationId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(authSchema.organization).values({
        id: organizationId,
        name: "Personal Organization",
        slug: `personal-${user.id.slice(0, 8)}`,
        createdAt: new Date(),
        metadata: JSON.stringify({ isPersonal: true }),
      });
      await tx.insert(authSchema.member).values({
        id: randomUUID(),
        organizationId,
        userId: user.id,
        role: "owner",
        createdAt: new Date(),
      });
    });
  },

  async canCreateInitialAccount() {
    if (getConfiguredControlPlaneMode() === "cloud") {
      return true;
    }
    const result = await db.select({ value: count() }).from(authSchema.user);
    return (result[0]?.value ?? 0) === 0;
  },

  async isPersonalOrganization(organizationId) {
    const organization = await db
      .select({ metadata: authSchema.organization.metadata })
      .from(authSchema.organization)
      .where(eq(authSchema.organization.id, organizationId))
      .limit(1)
      .then((rows) => rows[0]);
    if (!organization?.metadata) return false;
    try {
      return (
        (JSON.parse(organization.metadata) as { isPersonal?: boolean })
          .isPersonal === true
      );
    } catch {
      return false;
    }
  },

  async assertOrganizationDeletionAllowed(organizationId) {
    const [schedule] = await db
      .select({ id: backupSchedule.id })
      .from(backupSchedule)
      .where(eq(backupSchedule.organizationId, organizationId))
      .limit(1);
    if (schedule) {
      return "Delete all organization backup schedules before deleting the organization, so stored backup artifacts can be cleaned safely.";
    }

    const [run] = await db
      .select({ id: backupRun.id })
      .from(backupRun)
      .where(eq(backupRun.organizationId, organizationId))
      .limit(1);
    if (run) {
      return "This organization still has backup history. Remove the backup history through the backup workflow before deleting the organization.";
    }

    return null;
  },

  async isSsoEnforced(email) {
    const normalizedEmail = email.trim().toLowerCase();
    const enforcedMemberships = await db
      .select({ metadata: authSchema.organization.metadata })
      .from(authSchema.user)
      .innerJoin(
        authSchema.member,
        eq(authSchema.member.userId, authSchema.user.id),
      )
      .innerJoin(
        authSchema.organization,
        eq(authSchema.organization.id, authSchema.member.organizationId),
      )
      .innerJoin(
        authSchema.ssoProvider,
        and(
          eq(authSchema.ssoProvider.organizationId, authSchema.organization.id),
          eq(authSchema.ssoProvider.domainVerified, true),
        ),
      )
      .where(eq(authSchema.user.email, normalizedEmail))
      .limit(20);

    // An invitee may not have a user or membership row yet. Check pending
    // invitations as well, otherwise a password sign-up can be used to join
    // an organization that explicitly requires its verified SSO provider.
    const enforcedInvitations = await db
      .select({ metadata: authSchema.organization.metadata })
      .from(authSchema.invitation)
      .innerJoin(
        authSchema.organization,
        eq(authSchema.invitation.organizationId, authSchema.organization.id),
      )
      .innerJoin(
        authSchema.ssoProvider,
        and(
          eq(authSchema.ssoProvider.organizationId, authSchema.organization.id),
          eq(authSchema.ssoProvider.domainVerified, true),
        ),
      )
      .where(
        and(
          sql`lower(${authSchema.invitation.email}) = ${normalizedEmail}`,
          eq(authSchema.invitation.status, "pending"),
          gt(authSchema.invitation.expiresAt, new Date()),
        ),
      )
      .limit(20);

    return [...enforcedMemberships, ...enforcedInvitations].some((row) => {
      try {
        return (
          (
            (row.metadata ? JSON.parse(row.metadata) : {}) as {
              ssoEnforced?: boolean;
            }
          ).ssoEnforced === true
        );
      } catch {
        return false;
      }
    });
  },

  async sendInvitationEmail({ id, email, role, organization, invitation }) {
    const channelId = invitation.emailChannelId as string | undefined;
    if (!channelId) return;
    const channel = await db
      .select()
      .from(notificationChannel)
      .where(eq(notificationChannel.id, channelId))
      .limit(1)
      .then((rows) => rows[0]);
    if (!channel || channel.organizationId !== organization.id) {
      throw new Error("Invitation email provider was not found");
    }
    if (channel.provider !== "email" && channel.provider !== "resend") {
      throw new Error("Invitation email provider must be Email or Resend");
    }
    const configuration = decryptNotificationConfiguration(
      NotificationChannelSchema.parse(channel),
    );
    const recipientConfiguration =
      configuration.type === "email" || configuration.type === "resend"
        ? { ...configuration, toAddresses: [email] }
        : configuration;
    const invitationUrl = new URL("/invitation", env.CORS_ORIGIN);
    invitationUrl.searchParams.set("token", id);
    await notificationTransport.send(recipientConfiguration, {
      title: `Invitation to join ${organization.name}`,
      message: `You have been invited to join ${organization.name} as ${role}.\n\nAccept your invitation: ${invitationUrl}`,
    });
  },

  async applyInvitationPermissions({ permissions, memberId }) {
    if (!permissions) return;
    await db
      .update(authSchema.member)
      .set({ permissions })
      .where(eq(authSchema.member.id, memberId));
  },
};

function resolveAuthSecret(): string {
  if (env.BETTER_AUTH_SECRET) {
    if (env.BETTER_AUTH_SECRET.length < 32) {
      throw new Error("BETTER_AUTH_SECRET must be at least 32 characters long");
    }
    return env.BETTER_AUTH_SECRET;
  }
  if (env.NODE_ENV === "test") {
    return "upstand-local-development-secret-that-is-at-least-32-characters";
  }
  throw new Error(
    "BETTER_AUTH_SECRET is required. Configure a secret of at least 32 characters in environment variables.",
  );
}

export const auth = createAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),
  secondaryStorage,
  stepUp,
  callbacks,
  configuration: {
    corsOrigin: env.CORS_ORIGIN || "http://localhost:3001",
    betterAuthUrl: env.BETTER_AUTH_URL || "http://localhost:3000",
    secret: resolveAuthSecret(),
    nodeEnv: env.NODE_ENV,
    trustedProxyHeaders: env.TRUSTED_PROXY_HEADERS,
    sharedCookieDomain: env.AUTH_COOKIE_DOMAIN,
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    isCloud: getConfiguredControlPlaneMode() === "cloud",
  },
});

/** Returns only whether a user has a local credential account. Never expose
 * password hashes or account tokens to the browser. */
export async function hasCredentialAccount(userId: string): Promise<boolean> {
  const account = await db
    .select({ id: authSchema.account.id })
    .from(authSchema.account)
    .where(
      and(
        eq(authSchema.account.userId, userId),
        eq(authSchema.account.providerId, "credential"),
      ),
    )
    .limit(1);
  return account.length > 0;
}

export { stepUp };
