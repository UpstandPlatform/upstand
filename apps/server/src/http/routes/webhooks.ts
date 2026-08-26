import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parseDomainMappings } from "@upstand/domain";
import { redis, withRedisTimeout } from "@upstand/redis";
import type { WebhookDeliveryStore } from "@upstand/usecases";
import {
  gitProviderOAuthManifestWebhookKey,
  ProcessSourceWebhookUseCase,
  parseResourceCredentials,
  QueueDeploymentUseCase,
} from "@upstand/usecases";
import type { CaddyResource } from "@upstand/usecases/ports/caddy";
import {
  CaddyServiceToken,
  DockerPreviewCleanupPortToken,
  UnitOfWorkToken,
} from "@upstand/usecases/tokens";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createHttpRateLimitMiddleware } from "../rate-limit";
import type { AppEnv } from "../types";

const webhookDeliveryStore: WebhookDeliveryStore = {
  async claim(key, ttlSeconds) {
    return (
      (await withRedisTimeout(redis.set(key, "1", "EX", ttlSeconds, "NX"))) ===
      "OK"
    );
  },
  async release(key) {
    await withRedisTimeout(redis.del(key));
  },
};

function readWebhookDeliveryId(
  c: Context<AppEnv>,
  provider: "github" | "gitlab" | "gitea" | "bitbucket" | "dockerhub",
): string | undefined {
  const headerNames: Record<typeof provider, readonly string[]> = {
    github: ["x-github-delivery"],
    gitlab: ["x-gitlab-event-uuid"],
    gitea: ["x-gitea-delivery", "x-gitea-delivery-id"],
    bitbucket: ["x-request-uuid"],
    dockerhub: ["x-dockerhub-delivery", "x-webhook-id"],
  };
  return headerNames[provider]
    .map((name) => c.req.header(name)?.trim())
    .find((value): value is string => Boolean(value));
}

export function registerWebhookRoutes(app: Hono<AppEnv>): void {
  const MAX_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;
  app.use(
    "/api/webhooks/*",
    createHttpRateLimitMiddleware({
      path: "webhooks",
      profile: "webhooks",
      onRejected: (c, message) => c.json({ error: message }, 429),
    }),
  );
  app.use(
    "/api/webhooks/*",
    bodyLimit({
      maxSize: MAX_WEBHOOK_BODY_BYTES,
      onError: (c) => c.json({ error: "Webhook payload is too large" }, 413),
    }),
  );

  const processGithubWebhook = async (
    c: Context<AppEnv>,
    providerId: string,
  ) => {
    const contentLength = Number(c.req.header("content-length") ?? 0);
    if (contentLength > MAX_WEBHOOK_BODY_BYTES) {
      return c.json({ error: "Webhook payload is too large" }, 413);
    }
    const scope = c.get("scope");
    const uow = scope.resolve(UnitOfWorkToken);

    const provider = await uow.gitProviderRepository.findById(providerId);
    if (!provider) return c.json({ error: "Git provider not found" }, 404);

    const config = JSON.parse(provider.config);
    const webhookSecret = config.githubWebhookSecret;

    const bodyText = await c.req.text();
    if (Buffer.byteLength(bodyText, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
      return c.json({ error: "Webhook payload is too large" }, 413);
    }
    const signature = c.req.header("x-hub-signature-256");

    if (!webhookSecret || !signature) {
      return c.json({ error: "Webhook signature is not configured" }, 401);
    }
    if (webhookSecret && signature) {
      const hmac = createHmac("sha256", webhookSecret);
      const digest = `sha256=${hmac.update(bodyText).digest("hex")}`;
      const trusted = Buffer.from(digest, "ascii");
      const received = Buffer.from(signature, "ascii");
      if (
        trusted.length !== received.length ||
        !timingSafeEqual(trusted, received)
      ) {
        return c.json({ error: "Invalid signature" }, 401);
      }
    }

    const event = c.req.header("x-github-event");
    if (event !== "pull_request") {
      try {
        const result = await new ProcessSourceWebhookUseCase(
          uow,
          undefined,
          webhookDeliveryStore,
        ).execute({
          providerId,
          provider: "github",
          bodyText,
          deliveryId: readWebhookDeliveryId(c, "github"),
          headers: {
            "x-github-event": event,
            "x-hub-signature-256": signature,
          },
        });
        return c.json(result, 202);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === "Invalid webhook signature") {
          return c.json({ error: message }, 401);
        }
        if (message === "Webhook delivery store unavailable") {
          return c.json({ error: "Webhook temporarily unavailable" }, 503);
        }
        c.get("log").error(error instanceof Error ? error : String(error), {
          message: "GitHub webhook processing failed",
        });
        return c.json({ error: "Unable to process webhook" }, 400);
      }
    }

    let payload: {
      action?: unknown;
      number?: unknown;
      pull_request?: { head?: { ref?: unknown } };
      repository?: { full_name?: unknown };
    };
    try {
      payload = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid webhook payload" }, 400);
    }
    const action = typeof payload.action === "string" ? payload.action : "";
    const prNumber = typeof payload.number === "number" ? payload.number : 0;
    const branchName =
      typeof payload.pull_request?.head?.ref === "string"
        ? payload.pull_request.head.ref
        : "";
    const repoFullName =
      typeof payload.repository?.full_name === "string"
        ? payload.repository.full_name
        : "";

    if (!branchName || !repoFullName || !prNumber) {
      return c.json({ error: "Invalid pull request payload" }, 400);
    }

    const deliveryId =
      c.req.header("x-github-delivery") ||
      createHmac("sha256", providerId).update(bodyText).digest("hex");
    const deliveryKey = `github-webhook:${providerId}:${deliveryId}`;
    let acceptedDelivery: string | null = null;
    try {
      acceptedDelivery = await withRedisTimeout(
        redis.set(deliveryKey, "1", "EX", 86_400, "NX"),
      );
    } catch (error) {
      c.get("log").error(error instanceof Error ? error : String(error), {
        message: "GitHub webhook replay store unavailable",
        providerId,
      });
      return c.json({ error: "Webhook temporarily unavailable" }, 503);
    }
    if (acceptedDelivery !== "OK") {
      return c.json({ accepted: true, duplicate: true }, 202);
    }

    try {
      const githubResources = uow.resourceRepository.findByProvider
        ? await uow.resourceRepository.findByProvider("github")
        : (await uow.resourceRepository.findMany()).filter(
            (resource) => resource.provider === "github",
          );
      const candidateResources = githubResources.filter((resource) => {
        try {
          const creds = parseResourceCredentials(resource.credentials);
          return (
            creds.repository === repoFullName &&
            (resource.isPreviewDeploymentsActive === true ||
              creds.enablePrPreviews === true) &&
            creds.githubAccount === providerId
          );
        } catch {
          return false;
        }
      });
      const environmentEntries = await Promise.all(
        [
          ...new Set(
            candidateResources.map((resource) => resource.environmentId),
          ),
        ].map(
          async (environmentId) =>
            [
              environmentId,
              await uow.environmentRepository.findById(environmentId),
            ] as const,
        ),
      );
      const environments = new Map(environmentEntries);
      const projectEntries = await Promise.all(
        [
          ...new Set(
            [...environments.values()]
              .filter(
                (environment): environment is NonNullable<typeof environment> =>
                  environment !== null,
              )
              .map((environment) => environment.projectId),
          ),
        ].map(
          async (projectId) =>
            [
              projectId,
              await uow.projectRepository.findById(projectId),
            ] as const,
        ),
      );
      const projects = new Map(projectEntries);
      const matchedResources = candidateResources.filter((resource) => {
        const environment = environments.get(resource.environmentId);
        const project = environment
          ? projects.get(environment.projectId)
          : null;
        return project?.organizationId === provider.organizationId;
      });

      for (const resource of matchedResources) {
        if (action === "opened" || action === "synchronize") {
          let preview =
            await uow.previewDeploymentRepository.findByPullRequestId(
              resource.id,
              prNumber,
            );
          let appName = preview?.appName;
          let domain = preview?.domain;

          if (!preview) {
            const previewLimit = resource.previewLimit ?? 3;
            const hash = randomBytes(3).toString("hex");
            appName = `pr-${prNumber}-${resource.name}-${hash}`
              .toLowerCase()
              .replace(/[^a-z0-9_-]/g, "-");

            domain = `${appName}.${resource.previewWildcard || "sslip.io"}`;
            if (!appName || !domain) {
              throw new Error("Preview identity generation failed");
            }
            const generatedAppName = appName;
            const generatedDomain = domain;

            try {
              let limitReached = false;
              preview = await uow.transaction(async (tx) => {
                await tx.resourceRepository.lockById?.(resource.id);
                const existingPreviews =
                  await tx.previewDeploymentRepository.findByResourceId(
                    resource.id,
                  );
                if (
                  existingPreviews.filter(
                    (candidate) => candidate.status !== "failed",
                  ).length >= previewLimit
                ) {
                  limitReached = true;
                  return null;
                }
                return tx.previewDeploymentRepository.create({
                  resourceId: resource.id,
                  pullRequestId: prNumber,
                  branchName,
                  appName: generatedAppName,
                  status: "idle",
                  domain: generatedDomain,
                });
              });
              if (limitReached) {
                c.get("log").warn("Preview deployment limit reached", {
                  resourceId: resource.id,
                  previewLimit,
                });
                continue;
              }
              if (!preview) throw new Error("Preview creation returned no row");
            } catch {
              // A concurrent delivery may have won the unique PR claim.
              preview =
                await uow.previewDeploymentRepository.findByPullRequestId(
                  resource.id,
                  prNumber,
                );
              if (!preview) throw new Error("Preview creation failed");
              appName = preview.appName;
              domain = preview.domain;
            }
          } else {
            await uow.previewDeploymentRepository.updateById(preview.id, {
              status: "idle",
              branchName,
            });
          }

          await new QueueDeploymentUseCase(uow).execute({
            resourceId: resource.id,
            correlationId: c.get("correlationId"),
            title: `PR #${prNumber} preview deployment (${action})`,
            previewDeploymentId: preview.id,
          });
        } else if (action === "closed") {
          const preview =
            await uow.previewDeploymentRepository.findByPullRequestId(
              resource.id,
              prNumber,
            );
          if (preview) {
            c.get("log").info(
              `Cleaning up preview deployment ${preview.appName} on PR close...`,
            );

            const serviceRemoved = await (async () => {
              try {
                await scope
                  .resolve(DockerPreviewCleanupPortToken)
                  .removeServiceByName(preview.appName, preview.resourceId);
                return true;
              } catch {
                return false;
              }
            })();

            if (serviceRemoved) {
              await uow.previewDeploymentRepository.deleteById(preview.id);
            } else {
              // Retain a durable retry marker. Deleting the row after a
              // failed remote cleanup loses the only record needed to retry.
              await uow.previewDeploymentRepository.updateById(preview.id, {
                status: "cleanup_pending",
              });
              c.get("log").warn("Preview cleanup retained for retry", {
                previewId: preview.id,
                appName: preview.appName,
              });
            }

            try {
              const [resources, settings, allPreviews] = await Promise.all([
                uow.resourceRepository.findForCaddy
                  ? uow.resourceRepository.findForCaddy()
                  : uow.resourceRepository.findMany(),
                uow.webServerSettingsRepository.findGlobal(),
                uow.previewDeploymentRepository.findForCaddy
                  ? uow.previewDeploymentRepository.findForCaddy()
                  : uow.previewDeploymentRepository.findMany(),
              ]);
              const caddyService = scope.resolve(CaddyServiceToken);

              const routingResources = resources.filter(
                (candidate) =>
                  !candidate.serverId ||
                  candidate.serverId === "local" ||
                  candidate.serverId === "manager",
              );

              const activePreviews = allPreviews.filter(
                (p) => p.status === "success",
              );
              const resourcesById = new Map(
                resources.map((resource) => [resource.id, resource]),
              );
              const routingPreviews: CaddyResource[] = [];
              for (const prev of activePreviews) {
                const parent = resourcesById.get(prev.resourceId);
                if (parent) {
                  const parentDomains = parseDomainMappings(parent.domains);
                  const parentPort =
                    parent.previewPort || parentDomains[0]?.port || 80;
                  const parentHttps =
                    parent.previewHttps || (parentDomains[0]?.https ?? false);
                  const parentCert =
                    parentDomains[0]?.certificateType ?? "letsencrypt";
                  const parentCertId = parentDomains[0]?.certificateId;
                  const parentMiddlewares = parentDomains[0]?.middlewares ?? [];

                  routingPreviews.push({
                    id: prev.id,
                    name: prev.appName,
                    type: "application",
                    appName: prev.appName,
                    domains: JSON.stringify([
                      {
                        host: prev.domain,
                        path: "/",
                        port: parentPort,
                        https: parentHttps,
                        certificateType: parentCert,
                        ...(parentCertId !== undefined && {
                          certificateId: parentCertId,
                        }),
                        middlewares: parentMiddlewares,
                      },
                    ]),
                    composeType: parent.composeType,
                    advancedConfig: parent.advancedConfig,
                  });
                }
              }

              const certificates =
                (await uow.certificateRepository.findAll?.()) ?? [];
              await caddyService.syncResourceConfigs(
                [...routingResources, ...routingPreviews],
                settings || {},
                certificates,
              );
            } catch (err) {
              c.get("log").error(err instanceof Error ? err : String(err), {
                message: "Failed to sync Caddy on preview cleanup",
              });
            }
          }
        }
      }

      return c.json({ accepted: true }, 200);
    } catch (error) {
      await withRedisTimeout(redis.del(deliveryKey)).catch(() => undefined);
      c.get("log").error(error instanceof Error ? error : String(error), {
        message: "GitHub pull request webhook processing failed",
        providerId,
      });
      return c.json({ error: "Unable to process webhook" }, 500);
    }
  };

  app.post("/api/webhooks/github/:providerId", (c) =>
    processGithubWebhook(c, c.req.param("providerId")),
  );

  app.post("/api/webhooks/github/manifest/:state", async (c) => {
    const state = c.req.param("state");
    let providerId: string | null;
    try {
      providerId = await withRedisTimeout(
        redis.get(gitProviderOAuthManifestWebhookKey(state)),
      );
    } catch (error) {
      c.get("log").error(error instanceof Error ? error : String(error), {
        message: "GitHub manifest webhook lookup unavailable",
      });
      return c.json({ error: "Webhook temporarily unavailable" }, 503);
    }
    if (!providerId) return c.json({ error: "GitHub app not found" }, 404);
    return processGithubWebhook(c, providerId);
  });

  async function processNonGithubWebhook(
    c: Context<AppEnv>,
    provider: "gitlab" | "gitea" | "bitbucket" | "dockerhub",
  ) {
    const providerId = c.req.param("providerId");
    if (!providerId) return c.json({ error: "Provider ID is required" }, 400);
    const contentLength = Number(c.req.header("content-length") ?? 0);
    if (contentLength > MAX_WEBHOOK_BODY_BYTES) {
      return c.json({ error: "Webhook payload is too large" }, 413);
    }
    const bodyText = await c.req.text();
    if (Buffer.byteLength(bodyText, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
      return c.json({ error: "Webhook payload is too large" }, 413);
    }
    const scope = c.get("scope");
    const uow = scope.resolve(UnitOfWorkToken);
    const headers = {
      "x-gitlab-token": c.req.header("x-gitlab-token"),
      "x-hub-signature": c.req.header("x-hub-signature"),
      "x-gitea-signature": c.req.header("x-gitea-signature"),
    };
    try {
      const result = await new ProcessSourceWebhookUseCase(
        uow,
        undefined,
        webhookDeliveryStore,
      ).execute({
        providerId,
        provider,
        bodyText,
        deliveryId: readWebhookDeliveryId(c, provider),
        headers,
      });
      return c.json(result, 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Invalid webhook signature") {
        return c.json({ error: message }, 401);
      }
      if (message === "Git provider not found") {
        return c.json({ error: message }, 404);
      }
      if (message === "Webhook delivery store unavailable") {
        return c.json({ error: "Webhook temporarily unavailable" }, 503);
      }
      c.get("log").error(error instanceof Error ? error : String(error), {
        message: `${provider} webhook processing failed`,
      });
      return c.json({ error: "Unable to process webhook" }, 400);
    }
  }

  app.post("/api/webhooks/gitlab/:providerId", (c) =>
    processNonGithubWebhook(c, "gitlab"),
  );
  app.post("/api/webhooks/gitea/:providerId", (c) =>
    processNonGithubWebhook(c, "gitea"),
  );
  app.post("/api/webhooks/bitbucket/:providerId", (c) =>
    processNonGithubWebhook(c, "bitbucket"),
  );
  app.post("/api/webhooks/dockerhub/:providerId", (c) =>
    processNonGithubWebhook(c, "dockerhub"),
  );
}
