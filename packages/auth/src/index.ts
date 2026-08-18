import { apiKey } from "@better-auth/api-key";
import { sso } from "@better-auth/sso";
import {
  ORGANIZATION_ROLE_STATEMENTS,
  ORGANIZATION_STATEMENT,
} from "@upstand/domain";
import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { admin, organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { twoFactor } from "better-auth/plugins/two-factor";
import type { StepUpAuth } from "./step-up-auth";

type BetterAuthOptions = Parameters<typeof betterAuth>[0];

export type AuthDatabase = NonNullable<BetterAuthOptions["database"]>;
export type AuthSecondaryStorage = NonNullable<
  BetterAuthOptions["secondaryStorage"]
>;

export interface AuthConfiguration {
  corsOrigin: string;
  betterAuthUrl: string;
  secret: string;
  nodeEnv: string;
  trustedProxyHeaders?: boolean;
  sharedCookieDomain?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  isCloud?: boolean;
}

export interface AuthCallbacks {
  createPersonalOrganization(user: { id: string }): Promise<void>;
  canCreateInitialAccount(): Promise<boolean>;
  isPersonalOrganization(organizationId: string): Promise<boolean>;
  assertOrganizationDeletionAllowed(
    organizationId: string,
  ): Promise<string | null>;
  isSsoEnforced(email: string): Promise<boolean>;
  sendInvitationEmail(input: {
    id: string;
    email: string;
    role: string;
    organization: { id: string; name: string };
    invitation: Record<string, unknown>;
  }): Promise<void>;
  applyInvitationPermissions(input: {
    permissions: string | null | undefined;
    memberId: string;
  }): Promise<void>;
}

const memberPermissionField = {
  type: "string",
  required: false,
} as const;

type UnknownRecord = Record<string, unknown>;
interface JsonRequest {
  json(): Promise<unknown>;
}

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

async function readJsonRecord(request: JsonRequest): Promise<UnknownRecord> {
  const body: unknown = await request.json().catch(() => null);
  return isUnknownRecord(body) ? body : {};
}

export function resolveSharedCookieDomain(
  configuration: AuthConfiguration,
): string | undefined {
  const configuredDomain = configuration.sharedCookieDomain
    ?.trim()
    .toLowerCase()
    .replace(/^\./, "");
  if (!configuredDomain) return undefined;

  const dashboardHost = new URL(configuration.corsOrigin).hostname;
  const apiHost = new URL(configuration.betterAuthUrl).hostname;
  const usesDomain = (host: string) =>
    host === configuredDomain || host.endsWith(`.${configuredDomain}`);
  if (!configuredDomain.includes(".") || !usesDomain(dashboardHost)) {
    throw new Error("AUTH_COOKIE_DOMAIN does not match the dashboard hostname");
  }
  if (!usesDomain(apiHost)) {
    throw new Error("AUTH_COOKIE_DOMAIN does not match the API hostname");
  }
  return dashboardHost === apiHost ? undefined : configuredDomain;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
}

function isDirectHost(hostname: string): boolean {
  return (
    isLoopbackHost(hostname) ||
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) ||
    (hostname.startsWith("[") && hostname.endsWith("]"))
  );
}

export function resolveTrustedOrigins(
  configuration: Pick<
    AuthConfiguration,
    "corsOrigin" | "betterAuthUrl" | "nodeEnv"
  >,
): string[] {
  const origins = [configuration.corsOrigin, configuration.betterAuthUrl].map(
    (origin) => new URL(origin).origin,
  );
  if (configuration.nodeEnv !== "production") {
    origins.push(
      "http://localhost:3001",
      "http://127.0.0.1:3001",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    );
  }
  return Array.from(new Set(origins));
}

const organizationAccessControl = createAccessControl(ORGANIZATION_STATEMENT);
const organizationRoles = {
  owner: organizationAccessControl.newRole(ORGANIZATION_ROLE_STATEMENTS.owner),
  admin: organizationAccessControl.newRole(ORGANIZATION_ROLE_STATEMENTS.admin),
  member: organizationAccessControl.newRole(
    ORGANIZATION_ROLE_STATEMENTS.member,
  ),
};

export function createAuth(options: {
  database: AuthDatabase;
  secondaryStorage: AuthSecondaryStorage;
  configuration: AuthConfiguration;
  callbacks: AuthCallbacks;
  stepUp: StepUpAuth;
}) {
  const { database, secondaryStorage, configuration, callbacks, stepUp } =
    options;
  const sharedCookieDomain = resolveSharedCookieDomain(configuration);
  // The self-hosted installer can intentionally run the first boot on direct
  // HTTP origins when DNS/TLS are not configured yet. Secure cookies are
  // correct for HTTPS production deployments, but browsers reject them over
  // that documented HTTP bootstrap path.
  const secureCookies =
    configuration.nodeEnv === "production" &&
    [configuration.betterAuthUrl, configuration.corsOrigin].every((origin) =>
      origin?.startsWith("https://"),
    );

  const auth = betterAuth({
    database,
    trustedOrigins: async (request?: Request) => {
      const origins = resolveTrustedOrigins(configuration);
      if (request?.headers) {
        const origin =
          request.headers.get("origin") || request.headers.get("referer");
        if (origin) {
          try {
            const parsed = new URL(origin);
            if (isDirectHost(parsed.hostname)) {
              origins.push(parsed.origin);
            }
          } catch {}
        }
      }
      return Array.from(new Set(origins));
    },
    emailAndPassword: {
      enabled: true,
      // The dashboard's local bootstrap and normal sign-up flow expect the
      // newly created account to receive a session immediately. Email
      // verification remains independently configurable for deployments that
      // require it.
      autoSignIn: true,
    },
    user: {
      // Admin-created members still use Better Auth's normal credential
      // account and can sign in immediately with the password they were given.
      additionalFields: {
        managed: {
          type: "boolean",
          required: false,
          defaultValue: false,
        },
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
      },
    },
    socialProviders: {
      google:
        configuration.googleClientId && configuration.googleClientSecret
          ? {
              clientId: configuration.googleClientId,
              clientSecret: configuration.googleClientSecret,
            }
          : undefined,
    },
    secret: configuration.secret,
    baseURL: configuration.betterAuthUrl,
    session: {
      // Keep sessions short-lived and rotate the token on a daily activity
      // boundary. Database persistence provides recovery if Redis is rebuilt.
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // Session settings are available throughout the valid session lifetime.
      // Better Auth's list-sessions endpoint uses the fresh-session middleware;
      // leaving its default one-day freshness window makes the settings tab
      // return 403 for otherwise valid seven-day cloud sessions.
      freshAge: 0,
      storeSessionInDatabase: true,
    },
    advanced: {
      useSecureCookies: secureCookies,
      trustedProxyHeaders: configuration.trustedProxyHeaders ?? false,
      crossSubDomainCookies: sharedCookieDomain
        ? {
            enabled: true,
            domain: sharedCookieDomain,
          }
        : undefined,
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: secureCookies,
        httpOnly: true,
      },
    },
    rateLimit: {
      enabled: true,
      window: 10,
      max: 100,
      storage: "secondary-storage",
      customRules: {
        "/sign-in/email": {
          window: 60,
          max: 10,
        },
        "/two-factor/verify-totp": {
          window: 60,
          max: 5,
        },
        "/two-factor/verify-backup-code": {
          window: 60,
          max: 5,
        },
      },
    },
    secondaryStorage,
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (configuration.isCloud) {
              return {
                data: {
                  ...user,
                  managed: true,
                },
              };
            }
          },
          after: async (user) => callbacks.createPersonalOrganization(user),
        },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path.endsWith("/two-factor/verify-totp") ||
          ctx.path.endsWith("/two-factor/verify-backup-code")
        ) {
          if (!ctx.request) return;
          const res = ctx.context.returned;
          const hasReturnedError =
            typeof res === "object" &&
            res !== null &&
            "error" in res &&
            Boolean((res as { error?: unknown }).error);
          const isSuccess =
            !res || (res instanceof Response ? res.ok : !hasReturnedError);
          if (isSuccess) {
            // A successful TOTP verification rotates the session and stores
            // that replacement in Better Auth's request context. Reading the
            // request cookie here can still resolve the pre-verification
            // session, leaving the new session without a step-up marker.
            const session =
              ctx.context.newSession ??
              (await auth.api.getSession({
                headers: ctx.request.headers,
              }));
            if (session) {
              await stepUp.recordStepUpVerification(session);
            }
          }
        }
        if (
          ctx.path.endsWith("/two-factor/disable") ||
          ctx.path.endsWith("/two-factor/enable") ||
          ctx.path.endsWith("/two-factor/generate-backup-codes")
        ) {
          const session = ctx.request
            ? await auth.api.getSession({ headers: ctx.request.headers })
            : null;
          if (session) await stepUp.clearStepUpVerification(session.session.id);
        }
      }),
      before: createAuthMiddleware(async (ctx) => {
        // A fresh self-hosted installation has no external identity provider to
        // bootstrap an administrator. Permit exactly that first email/password
        // account, then make the instance sign-in only. The database trigger in
        // migration 0015 is the race-safe enforcement; this hook returns a
        // useful API error before the database has to reject the request.
        if (ctx.path.endsWith("/sign-up/email")) {
          if (!(await callbacks.canCreateInitialAccount())) {
            return ctx.json(
              {
                error:
                  "This Upstand instance has already been configured. Sign in with the owner account.",
              },
              { status: 403 },
            );
          }

          if (ctx.request) {
            const body: UnknownRecord = await readJsonRecord(
              ctx.request.clone(),
            );
            const email =
              typeof body.email === "string" ? body.email.trim() : "";
            if (email && (await callbacks.isSsoEnforced(email))) {
              return ctx.json(
                {
                  error:
                    "This organization requires sign-in through its verified SSO provider.",
                },
                { status: 403 },
              );
            }
          }
        }

        if (ctx.path.startsWith("/organization/delete")) {
          if (!ctx.request) return;
          const body: UnknownRecord = await readJsonRecord(ctx.request);
          const organizationId =
            typeof body.organizationId === "string"
              ? body.organizationId
              : undefined;
          if (!organizationId) return;

          if (await callbacks.isPersonalOrganization(organizationId)) {
            return ctx.json(
              { error: "Cannot delete personal organization" },
              { status: 400 },
            );
          }

          const deletionBlocker =
            await callbacks.assertOrganizationDeletionAllowed(organizationId);
          if (deletionBlocker) {
            return ctx.json({ error: deletionBlocker }, { status: 409 });
          }
        }

        // Password sign-in must not become a bypass for an organization that
        // explicitly requires its verified identity provider. The
        // SSO endpoint is intentionally not blocked, and organizations with
        // no registered provider are ignored to prevent accidental lockout.
        if (ctx.path.endsWith("/sign-in/email")) {
          if (!ctx.request) return;
          const body: UnknownRecord = await readJsonRecord(ctx.request.clone());
          const email = typeof body.email === "string" ? body.email.trim() : "";
          if (!email) return;

          if (await callbacks.isSsoEnforced(email)) {
            return ctx.json(
              {
                error:
                  "This organization requires sign-in through its verified SSO provider.",
              },
              { status: 403 },
            );
          }
        }
      }),
    },
    plugins: [
      admin(),
      organization({
        ac: organizationAccessControl,
        roles: organizationRoles,
        schema: {
          member: {
            additionalFields: {
              permissions: memberPermissionField,
              scimActive: {
                type: "boolean",
                required: false,
                defaultValue: true,
              },
              scimExternalId: { type: "string", required: false },
            },
          },
          invitation: {
            additionalFields: {
              permissions: memberPermissionField,
              emailChannelId: { type: "string", required: false },
            },
          },
        },
        sendInvitationEmail: async ({
          id,
          email,
          role,
          organization,
          invitation,
        }) => {
          await callbacks.sendInvitationEmail({
            id,
            email,
            role,
            organization: { id: organization.id, name: organization.name },
            invitation: Object.fromEntries(Object.entries(invitation)),
          });
        },
        organizationHooks: {
          afterAcceptInvitation: async ({ invitation, member }) => {
            await callbacks.applyInvitationPermissions({
              permissions: invitation.permissions,
              memberId: member.id,
            });
          },
        },
      }),
      apiKey({
        configId: "upstand",
        references: "organization",
        defaultPrefix: "upk_",
        defaultKeyLength: 48,
        requireName: true,
        minimumNameLength: 1,
        maximumNameLength: 120,
        startingCharactersConfig: {
          shouldStore: true,
          charactersLength: 12,
        },
        enableMetadata: true,
        keyExpiration: {
          defaultExpiresIn: 90 * 24 * 60 * 60 * 1000,
          minExpiresIn: 1,
          maxExpiresIn: 365,
        },
        rateLimit: {
          enabled: true,
          timeWindow: 60 * 60 * 1000,
          maxRequests: 1_000,
        },
        storage: "secondary-storage",
        fallbackToDatabase: true,
        customAPIKeyGetter: (ctx) => {
          if (!ctx.request) return null;
          const explicit = ctx.request.headers.get("x-api-key")?.trim();
          if (explicit) return explicit;
          const authorization = ctx.request.headers.get("authorization") || "";
          return authorization.startsWith("Bearer ")
            ? authorization.slice("Bearer ".length).trim() || null
            : null;
        },
      }),
      twoFactor({
        issuer: "Upstand",
        allowPasswordless: true,
      }),
      sso({
        domainVerification: {
          enabled: true,
          tokenPrefix: "upstand-sso",
        },
        organizationProvisioning: {
          defaultRole: "member",
        },
        provisionUserOnEveryLogin: true,
        redirectURI: "/api/auth/sso/callback",
        saml: {
          enableInResponseToValidation: true,
          allowIdpInitiated: true,
          requireTimestamps: true,
          algorithms: { onDeprecated: "reject" },
        },
        providersLimit: 10,
      }),
    ],
  });

  return auth;
}
