import { randomUUID } from "node:crypto";
import { type AuthCallbacks, createAuth } from "@upstand/auth";
import { createStepUpAuth } from "@upstand/auth/step-up-auth";
import { db } from "@upstand/db";
import * as authSchema from "@upstand/db/schema/auth";
import { notificationChannel } from "@upstand/db/schema/notification";
import { NotificationChannelSchema } from "@upstand/domain";
import { env } from "@upstand/env/server";
import { NotificationTransportRegistry } from "@upstand/infrastructure";
import { redis } from "@upstand/redis";
import { decryptNotificationConfiguration } from "@upstand/usecases";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, count, eq } from "drizzle-orm";

export const notificationTransport = new NotificationTransportRegistry();

const stepUp = createStepUpAuth({
  get: (key) => redis.get(key),
  set: (key, value, mode, ttl) => redis.set(key, value, mode, ttl),
  del: (key) => redis.del(key),
});

const secondaryStorage = {
  get: async (key: string) => (await redis.get(key)) || null,
  set: async (key: string, value: string, ttl?: number) => {
    if (ttl) await redis.set(key, value, "EX", ttl);
    else await redis.set(key, value);
  },
  delete: (key: string) => redis.del(key).then(() => undefined),
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
    if (env.IS_CLOUD) {
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

  async isSsoEnforced(email) {
    const enforced = await db
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
      .where(eq(authSchema.user.email, email.toLowerCase()))
      .limit(20);
    return enforced.some((row) => {
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
    secret:
      env.BETTER_AUTH_SECRET ||
      "upstand-local-development-secret-that-is-at-least-32-characters",
    nodeEnv: env.NODE_ENV,
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  },
});

export { stepUp };
