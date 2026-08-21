import { auth } from "@upstand/api/auth";
import { checkPermission } from "@upstand/api/permissions";
import { normalizeDirectIpAuthRequest } from "@upstand/auth";
import { env } from "@upstand/env/server";
import {
  readResponseJsonLimited,
  readResponseTextLimited,
} from "@upstand/platform/network/response-body";
import { redis, withRedisTimeout } from "@upstand/redis";
import {
  assertSafeProviderUrlAsync,
  GITHUB_MANIFEST_WEBHOOK_TTL_SECONDS,
  gitProviderOAuthManifestWebhookKey,
  gitProviderOAuthStateKey,
  parseGitProviderOAuthState,
} from "@upstand/usecases";
import {
  CreateGitProviderUseCaseToken,
  UnitOfWorkToken,
} from "@upstand/usecases/tokens";
import type { Context, Hono } from "hono";
import type { AppEnv } from "../types";

function getDashboardUrl(path: string): string {
  return new URL(path, env.CORS_ORIGIN).toString();
}

export function registerProviderRoutes(app: Hono<AppEnv>): void {
  app.get("/api/providers/github/setup", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const installationId = c.req.query("installation_id");
    const oauthState = typeof state === "string" ? state : "";

    if ((!code && !installationId) || !oauthState) {
      return c.json({ error: "Missing GitHub callback parameters" }, 400);
    }

    const scope = c.get("scope");

    // GitHub calls setup_url after the app is installed. That callback has an
    // installation_id but no conversion code and arrives after the one-time
    // manifest conversion state has been consumed. Resolve the provider via
    // the durable manifest webhook binding, then bind the installation.
    if (!code && installationId) {
      const manifestState = parseGitProviderOAuthState(oauthState);
      if (manifestState?.purpose !== "github-init") {
        return c.json({ error: "GitHub app setup state is invalid" }, 400);
      }
      const providerIdResult = await withRedisTimeout(
        redis.eval(
          "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value",
          1,
          gitProviderOAuthManifestWebhookKey(oauthState),
        ),
      );
      const providerId =
        typeof providerIdResult === "string" ? providerIdResult : null;
      if (!providerId) {
        return c.json({ error: "GitHub app setup state is invalid" }, 400);
      }

      try {
        const callbackSession = await auth.api.getSession({
          headers: normalizeDirectIpAuthRequest(c.req.raw).headers,
        });
        const uow = scope.resolve(UnitOfWorkToken);
        const provider = await uow.gitProviderRepository.findById(providerId);
        if (!provider) return c.text("Git Provider not found", 404);
        if (
          !callbackSession ||
          callbackSession.user.id !== manifestState.userId
        ) {
          return c.json({ error: "OAuth state actor is no longer valid" }, 403);
        }
        if (provider.organizationId !== manifestState.organizationId) {
          return c.json({ error: "OAuth state organization mismatch" }, 403);
        }
        await checkPermission(
          callbackSession.user.id,
          provider.organizationId,
          "git_provider:create",
        );

        const configObj = JSON.parse(provider.config) as Record<
          string,
          unknown
        >;
        configObj.githubInstallationId = installationId;
        await uow.gitProviderRepository.updateById(providerId, {
          config: JSON.stringify(configObj),
        });
        return c.redirect(getDashboardUrl("/git-providers"), 307);
      } catch (err) {
        c.get("log").error(err instanceof Error ? err : String(err), {
          message: "GitHub installation update failed",
          providerId,
        });
        return c.text("GitHub installation update failed", 500);
      }
    }

    const parsedState = parseGitProviderOAuthState(oauthState);
    if (!parsedState) {
      return c.json({ error: "Invalid or expired GitHub OAuth state" }, 400);
    }
    const storedStateSubject = await withRedisTimeout(
      redis.eval(
        "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value",
        1,
        gitProviderOAuthStateKey(oauthState),
      ),
    );
    if (storedStateSubject !== parsedState.providerId) {
      return c.json(
        { error: "GitHub OAuth state was already used or is invalid" },
        400,
      );
    }
    const callbackSession = await auth.api.getSession({
      headers: normalizeDirectIpAuthRequest(c.req.raw).headers,
    });
    if (!callbackSession || callbackSession.user.id !== parsedState.userId) {
      return c.json({ error: "OAuth state actor is no longer valid" }, 403);
    }

    let action: "gh_init" | "gh_setup";
    let rest: string[];
    if (parsedState.purpose === "github-init") {
      const [, organizationId, userId] = parsedState.providerId.split(":");
      if (!organizationId || !userId) {
        return c.json({ error: "Invalid GitHub manifest state" }, 400);
      }
      action = "gh_init";
      rest = [organizationId, userId];
    } else if (parsedState.purpose === "github-install") {
      action = "gh_setup";
      rest = [parsedState.providerId];
    } else {
      return c.json({ error: "Invalid GitHub OAuth state purpose" }, 400);
    }

    if (action === "gh_init") {
      const organizationId = rest[0];
      if (!organizationId) {
        return c.json({ error: "Missing organizationId in state" }, 400);
      }
      if (organizationId !== parsedState.organizationId) {
        return c.json({ error: "OAuth state organization mismatch" }, 403);
      }
      await checkPermission(
        callbackSession.user.id,
        organizationId,
        "git_provider:create",
      );

      let createdProviderId: string | undefined;
      try {
        const res = await fetch(
          `https://api.github.com/app-manifests/${code}/conversions`,
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(15_000),
            headers: {
              Accept: "application/vnd.github+json",
              "User-Agent": "Upstand",
            },
          },
        );

        if (!res.ok) {
          await readResponseTextLimited(res, 4096);
          c.get("log").warn("GitHub App conversion failed", {
            status: res.status,
          });
          return c.text("GitHub App conversion failed", 500);
        }

        const data = await readResponseJsonLimited<{
          name: string;
          slug: string;
          html_url: string;
          id: number;
          client_id: string;
          client_secret: string;
          webhook_secret: string;
          pem: string;
        }>(res);

        const configObj = {
          githubAppId: data.id,
          githubAppSlug: data.slug,
          githubClientId: data.client_id,
          githubClientSecret: data.client_secret,
          githubWebhookSecret: data.webhook_secret,
          githubPrivateKey: data.pem,
          githubAppName: data.html_url,
        };

        const createUseCase = scope.resolve(CreateGitProviderUseCaseToken);
        const provider = await createUseCase.execute({
          organizationId,
          name: data.name,
          provider: "github",
          config: JSON.stringify(configObj),
        });
        createdProviderId = provider.id;
        await withRedisTimeout(
          redis.set(
            gitProviderOAuthManifestWebhookKey(oauthState),
            provider.id,
            "EX",
            GITHUB_MANIFEST_WEBHOOK_TTL_SECONDS,
          ),
        );
      } catch (err) {
        await withRedisTimeout(
          redis.del(gitProviderOAuthManifestWebhookKey(oauthState)),
        ).catch(() => undefined);
        if (createdProviderId) {
          await scope
            .resolve(UnitOfWorkToken)
            .gitProviderRepository.deleteById(createdProviderId)
            .catch((cleanupError: unknown) => {
              c.get("log").error(
                cleanupError instanceof Error
                  ? cleanupError
                  : String(cleanupError),
                {
                  message: "Failed to clean up incomplete GitHub provider",
                  providerId: createdProviderId,
                },
              );
            });
        }
        c.get("log").error(err instanceof Error ? err : String(err), {
          message: "GitHub setup failed",
          organizationId,
        });
        return c.text("GitHub setup failed", 500);
      }
    } else if (action === "gh_setup") {
      const gitProviderId = rest[0];
      if (!gitProviderId) {
        return c.json({ error: "Missing gitProviderId in state" }, 400);
      }
      if (!installationId) {
        return c.json({ error: "Missing GitHub installation ID" }, 400);
      }

      try {
        const uow = scope.resolve(UnitOfWorkToken);
        const provider =
          await uow.gitProviderRepository.findById(gitProviderId);
        if (!provider) {
          return c.text("Git Provider not found", 404);
        }
        if (provider.organizationId !== parsedState.organizationId) {
          return c.text("OAuth state organization mismatch", 403);
        }
        await checkPermission(
          callbackSession.user.id,
          provider.organizationId,
          "git_provider:create",
        );

        const configObj = JSON.parse(provider.config);
        configObj.githubInstallationId = installationId;

        await uow.gitProviderRepository.updateById(gitProviderId, {
          config: JSON.stringify(configObj),
        });
      } catch (err) {
        c.get("log").error(err instanceof Error ? err : String(err), {
          message: "GitHub installation update failed",
          gitProviderId,
        });
        return c.text("GitHub installation update failed", 500);
      }
    }

    return c.redirect(getDashboardUrl("/git-providers"), 307);
  });

  async function verifyOAuthStateAndGetProvider(
    c: Context<AppEnv>,
    state: string,
  ) {
    const parsedState = parseGitProviderOAuthState(state);
    if (parsedState?.purpose !== "provider-oauth") {
      return {
        response: c.json({ error: "Invalid or expired OAuth state" }, 400),
      };
    }
    const storedProviderId = await withRedisTimeout(
      redis.eval(
        "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value",
        1,
        gitProviderOAuthStateKey(state),
      ),
    );
    if (storedProviderId !== parsedState.providerId) {
      return {
        response: c.json(
          { error: "OAuth state was already used or is invalid" },
          400,
        ),
      };
    }
    const scope = c.get("scope");
    const uow = scope.resolve(UnitOfWorkToken);
    const provider = await uow.gitProviderRepository.findById(
      parsedState.providerId,
    );
    if (!provider) {
      return { response: c.text("Git Provider not found", 404) };
    }
    const session = await auth.api.getSession({
      headers: normalizeDirectIpAuthRequest(c.req.raw).headers,
    });
    if (
      provider.organizationId !== parsedState.organizationId ||
      !session ||
      session.user.id !== parsedState.userId
    ) {
      return { response: c.text("OAuth state actor is no longer valid", 403) };
    }
    await checkPermission(
      session.user.id,
      provider.organizationId,
      "git_provider:create",
    );
    return { provider, uow };
  }

  app.get("/api/providers/gitlab/setup", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");

    if (!code || !state) {
      return c.json({ error: "Missing code or state parameter" }, 400);
    }

    try {
      const verified = await verifyOAuthStateAndGetProvider(c, state);
      if (verified.response) return verified.response;
      const { provider, uow } = verified;

      const configObj = JSON.parse(provider.config);
      const gitlabUrl = await assertSafeProviderUrlAsync(configObj.gitlabUrl);
      const redirectUri = new URL(
        "/api/providers/gitlab/setup",
        env.BETTER_AUTH_URL,
      ).toString();

      const res = await fetch(`${gitlabUrl}/oauth/token`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: configObj.applicationId,
          client_secret: configObj.secret,
        }),
      });

      if (!res.ok) {
        await readResponseTextLimited(res, 4096);
        c.get("log").warn("GitLab OAuth exchange failed", {
          status: res.status,
        });
        return c.text("GitLab OAuth exchange failed", 500);
      }

      const data = await readResponseJsonLimited<{
        access_token: string;
        refresh_token: string;
        expires_in: number;
      }>(res);

      configObj.accessToken = data.access_token;
      configObj.refreshToken = data.refresh_token;
      configObj.expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;

      await uow.gitProviderRepository.updateById(provider.id, {
        config: JSON.stringify(configObj),
      });
    } catch (err) {
      c.get("log").error(err instanceof Error ? err : String(err), {
        message: "GitLab setup failed",
      });
      return c.text("GitLab setup failed", 500);
    }

    return c.redirect(getDashboardUrl("/git-providers"), 307);
  });

  app.get("/api/providers/gitea/setup", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");

    if (!code || !state) {
      return c.json({ error: "Missing code or state parameter" }, 400);
    }

    try {
      const verified = await verifyOAuthStateAndGetProvider(c, state);
      if (verified.response) return verified.response;
      const { provider, uow } = verified;

      const configObj = JSON.parse(provider.config);
      const giteaUrl = await assertSafeProviderUrlAsync(configObj.giteaUrl);
      const redirectUri = new URL(
        "/api/providers/gitea/setup",
        env.BETTER_AUTH_URL,
      ).toString();

      const res = await fetch(`${giteaUrl}/login/oauth/access_token`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: configObj.clientId,
          client_secret: configObj.clientSecret,
        }),
      });

      if (!res.ok) {
        await readResponseTextLimited(res, 4096);
        c.get("log").warn("Gitea OAuth exchange failed", {
          status: res.status,
        });
        return c.text("Gitea OAuth exchange failed", 500);
      }

      const data = await readResponseJsonLimited<{
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      }>(res);

      configObj.accessToken = data.access_token;
      configObj.refreshToken = data.refresh_token || "";
      configObj.expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;

      await uow.gitProviderRepository.updateById(provider.id, {
        config: JSON.stringify(configObj),
      });
    } catch (err) {
      c.get("log").error(err instanceof Error ? err : String(err), {
        message: "Gitea setup failed",
      });
      return c.text("Gitea setup failed", 500);
    }

    return c.redirect(getDashboardUrl("/git-providers"), 307);
  });
}
