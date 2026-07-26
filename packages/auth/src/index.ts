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
  googleClientId?: string;
  googleClientSecret?: string;
}

export interface AuthCallbacks {
  createPersonalOrganization(user: { id: string }): Promise<void>;
  canCreateInitialAccount(): Promise<boolean>;
  isPersonalOrganization(organizationId: string): Promise<boolean>;
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

function getSharedCookieDomain(
  configuration: AuthConfiguration,
): string | undefined {
  const dashboardHost = new URL(configuration.corsOrigin).hostname;
  const apiHost = new URL(configuration.betterAuthUrl).hostname;
  if (dashboardHost === apiHost) return undefined;

  // Protected pages are rendered by the dashboard hostname while sessions are
  // issued by the API hostname. Only sibling subdomains may share a cookie.
  const domain = dashboardHost.split(".").slice(1).join(".");
  return domain && apiHost.endsWith(`.${domain}`) ? domain : undefined;
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
  const sharedCookieDomain = getSharedCookieDomain(configuration);
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
    trustedOrigins: (request?: Request) => {
      const origins = [configuration.corsOrigin, configuration.betterAuthUrl];
      if (request) {
        try {
          const url = new URL(request.url);
          origins.push(url.origin);

          const forwardedHost = request.headers.get("x-forwarded-host");
          if (forwardedHost) {
            const proto = request.headers.get("x-forwarded-proto") || "https";
            origins.push(`${proto}://${forwardedHost}`);
          }

          const host = request.headers.get("host");
          if (host) {
            const proto = request.headers.get("x-forwarded-proto") || "https";
            origins.push(`${proto}://${host}`);
          }
        } catch {
          // Ignore malformed request URLs
        }
      }
      return Array.from(new Set(origins.filter(Boolean)));
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
      storeSessionInDatabase: true,
    },
    advanced: {
      useSecureCookies: secureCookies,
      trustedProxyHeaders: true,
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
    },
    secondaryStorage,
    databaseHooks: {
      user: {
        create: {
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
