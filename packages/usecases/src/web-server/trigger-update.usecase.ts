import { env } from "@upstand/env/server";
import { redis, withRedisLock } from "@upstand/redis";
import { log } from "evlog";
import { z } from "zod";
import type { NotificationPublisher } from "../notification/publish-notification.usecase";
import { requiresRemoteServerPlacement } from "../platform/platform.types";
import type { DockerSelfUpdatePort } from "../ports/docker";
import { GetUpdateStatusUseCase } from "./get-update-status.usecase";

export const TriggerUpdateInputSchema = z.object({
  version: z.string().trim().min(1, "Version is required").max(256),
  images: z.object({
    server: z.string().regex(/^sha256:[a-f0-9]{64}$/i),
    schedules: z.string().regex(/^sha256:[a-f0-9]{64}$/i),
    web: z.string().regex(/^sha256:[a-f0-9]{64}$/i),
    fumadocs: z.string().regex(/^sha256:[a-f0-9]{64}$/i),
    monitoring: z.string().regex(/^sha256:[a-f0-9]{64}$/i),
  }),
});

export type TriggerUpdateInput = z.infer<typeof TriggerUpdateInputSchema>;

export const SELF_UPDATE_LOCK_KEY = "upstand:control-plane:self-update";
export const SELF_UPDATE_LOCK_TTL_MS = 30 * 60 * 1_000;

const requiredSelfUpdateImages = [
  "server",
  "schedules",
  "web",
  "fumadocs",
] as const;
const managedSelfUpdateImages = new Map<
  string,
  (typeof requiredSelfUpdateImages)[number]
>([
  ["upstand-server", "server"],
  ["upstand-schedules", "schedules"],
  ["upstand-web", "web"],
  ["upstand-fumadocs", "fumadocs"],
  ["upstand_server", "server"],
  ["upstand_schedules", "schedules"],
  ["upstand_web", "web"],
  ["upstand_fumadocs", "fumadocs"],
] as const);

function buildSelfUpdateServiceUpdate(
  inspect: Awaited<ReturnType<DockerSelfUpdatePort["inspectService"]>>,
  imageName: (typeof requiredSelfUpdateImages)[number],
  version: string,
  repository: string,
  images: TriggerUpdateInput["images"],
) {
  const currentImage = inspect.taskTemplate.ContainerSpec?.Image || "";
  if (!currentImage) {
    throw new Error(
      `Self-update service '${inspect.name}' has no container image`,
    );
  }
  if (currentImage.includes(":source-")) {
    throw new Error(
      "This installation was built from source. Run the GitHub installer to update it, or reinstall from a published release image.",
    );
  }

  let baseImage = currentImage;
  if (baseImage.includes("@sha256:")) {
    baseImage = baseImage.split("@sha256:")[0] ?? baseImage;
  }
  const digestSeparator = baseImage.lastIndexOf("@");
  if (digestSeparator >= 0) baseImage = baseImage.slice(0, digestSeparator);
  const tagSeparator = baseImage.lastIndexOf(":");
  if (tagSeparator > baseImage.lastIndexOf("/")) {
    baseImage = baseImage.slice(0, tagSeparator);
  }
  if (!baseImage.includes("/") || baseImage.startsWith("upstand-")) {
    baseImage = `ghcr.io/${repository}-${imageName}`;
  }

  const currentEnv = inspect.taskTemplate.ContainerSpec?.Env ?? [];
  let nextEnv = currentEnv.some((entry) => entry.startsWith("UPSTAND_VERSION="))
    ? currentEnv.map((entry) =>
        entry.startsWith("UPSTAND_VERSION=")
          ? `UPSTAND_VERSION=${version}`
          : entry,
      )
    : [...currentEnv, `UPSTAND_VERSION=${version}`];
  nextEnv = nextEnv.some((entry) =>
    entry.startsWith("UPSTAND_UPDATE_COMPLETION_VERSION="),
  )
    ? nextEnv.map((entry) =>
        entry.startsWith("UPSTAND_UPDATE_COMPLETION_VERSION=")
          ? `UPSTAND_UPDATE_COMPLETION_VERSION=${version}`
          : entry,
      )
    : [...nextEnv, `UPSTAND_UPDATE_COMPLETION_VERSION=${version}`];
  if (imageName === "server") {
    const monitoringBaseImage = baseImage.replace(/-server$/, "-monitoring");
    const monitoringImage = `${monitoringBaseImage}@${images.monitoring}`;
    nextEnv = nextEnv.some((entry) =>
      entry.startsWith("UPSTAND_MONITORING_IMAGE="),
    )
      ? nextEnv.map((entry) =>
          entry.startsWith("UPSTAND_MONITORING_IMAGE=")
            ? `UPSTAND_MONITORING_IMAGE=${monitoringImage}`
            : entry,
        )
      : [...nextEnv, `UPSTAND_MONITORING_IMAGE=${monitoringImage}`];
  }

  return {
    version: inspect.version,
    name: inspect.name,
    taskTemplate: {
      ...inspect.taskTemplate,
      ContainerSpec: {
        ...inspect.taskTemplate.ContainerSpec,
        Image: `${baseImage}@${images[imageName]}`,
        Env: nextEnv,
      },
      ForceUpdate: (inspect.taskTemplate.ForceUpdate || 0) + 1,
    },
    updateConfig: inspect.updateConfig,
    rollbackConfig: inspect.rollbackConfig,
    endpointSpec: inspect.endpointSpec,
  };
}

export type UpdateArtifactCleanup = {
  run(action: "images" | "builder"): Promise<unknown>;
};

export async function cleanupUpdateArtifacts(
  cleanup: UpdateArtifactCleanup | undefined,
  version: string,
): Promise<void> {
  if (!cleanup) return;

  for (const action of ["images", "builder"] as const) {
    try {
      await cleanup.run(action);
      log.info({
        message: `Cleaned unused Docker ${action} artifacts before self-update to ${version}`,
        metadata: { action, version },
      });
    } catch (error) {
      log.warn({
        message: `Unable to clean Docker ${action} artifacts before self-update; continuing with update`,
        err: error instanceof Error ? error.message : error,
        metadata: { action, version },
      });
    }
  }
}

export class TriggerUpdateUseCase {
  constructor(
    private readonly docker: DockerSelfUpdatePort,
    private readonly notificationPublisher?: NotificationPublisher,
    private readonly dockerCleanup?: UpdateArtifactCleanup,
  ) {}

  async execute(
    input: TriggerUpdateInput,
    options?: { allowManagedUpdate?: boolean },
  ): Promise<{ success: boolean }> {
    const managedControlPlane = requiresRemoteServerPlacement();
    if (managedControlPlane && options?.allowManagedUpdate !== true) {
      throw new Error(
        "Only the cloud instance owner can trigger a managed control-plane update.",
      );
    }
    const version = input.version;
    if (!/^v?\d+\.\d+\.\d+(?:[-+].*)?$/.test(version) && version !== "canary") {
      throw new Error(
        "Updates must target a published semantic release or canary channel",
      );
    }
    const verified = await new GetUpdateStatusUseCase().execute({
      forceRefresh: true,
      allowManagedUpdates: options?.allowManagedUpdate === true,
    });
    if (
      verified.latestVersion !== version ||
      !verified.images ||
      JSON.stringify(verified.images) !== JSON.stringify(input.images)
    ) {
      throw new Error(
        "The release manifest changed or the update plan expired. Check for updates again.",
      );
    }
    const result = await withRedisLock({
      redis,
      key: SELF_UPDATE_LOCK_KEY,
      ttlMs: SELF_UPDATE_LOCK_TTL_MS,
      operationTimeoutMs: 2_000,
      work: async () => {
        log.info({
          message: `Triggering self-update to version ${version}...`,
        });

        try {
          // Reclaim artifacts left by previous releases before pulling the next
          // set of immutable images. Volumes are intentionally excluded because
          // they contain application data and are not build artifacts.
          await cleanupUpdateArtifacts(this.dockerCleanup, version);

          let updatedCount = 0;
          if (this.docker.applySelfUpdate) {
            ({ updatedCount } = await this.docker.applySelfUpdate({
              version,
              repository: env.GITHUB_REPOSITORY,
              images: input.images,
            }));
          } else {
            const services = await this.docker.listServices();
            const plans = new Map<
              (typeof requiredSelfUpdateImages)[number],
              {
                serviceId: string;
                inspect: Awaited<
                  ReturnType<DockerSelfUpdatePort["inspectService"]>
                >;
                update: Awaited<
                  ReturnType<DockerSelfUpdatePort["inspectService"]>
                >;
              }
            >();

            for (const service of services) {
              const imageName = managedSelfUpdateImages.get(service.name);
              if (!imageName) continue;
              if (plans.has(imageName)) {
                throw new Error(
                  `Self-update found duplicate managed service for ${imageName}`,
                );
              }
              const inspect = await this.docker.inspectService(service.id);
              const update = buildSelfUpdateServiceUpdate(
                inspect,
                imageName,
                version,
                env.GITHUB_REPOSITORY,
                input.images,
              );
              plans.set(imageName, { serviceId: service.id, inspect, update });
            }

            const missing = requiredSelfUpdateImages.filter(
              (imageName) => !plans.has(imageName),
            );
            if (missing.length > 0) {
              throw new Error(
                `Self-update requires all managed services; missing: ${missing.join(", ")}`,
              );
            }

            const applied: (typeof plans extends Map<string, infer Value>
              ? Value
              : never)[] = [];
            try {
              for (const imageName of requiredSelfUpdateImages) {
                const plan = plans.get(imageName);
                if (!plan)
                  throw new Error(`Missing self-update plan for ${imageName}`);
                log.info({
                  message: `Updating Swarm service '${plan.update.name}'...`,
                });
                await this.docker.updateService(plan.serviceId, plan.update);
                applied.push(plan);
                updatedCount++;
              }
            } catch (error) {
              const failedImageName = requiredSelfUpdateImages[applied.length];
              const failedPlan = failedImageName
                ? plans.get(failedImageName)
                : undefined;
              const rollbackPlans = failedPlan
                ? [...applied, failedPlan]
                : [...applied];
              const rollbackErrors: string[] = [];
              for (const plan of rollbackPlans.reverse()) {
                try {
                  const current = await this.docker.inspectService(
                    plan.serviceId,
                  );
                  await this.docker.updateService(plan.serviceId, {
                    version: current.version,
                    name: plan.inspect.name,
                    taskTemplate: plan.inspect.taskTemplate,
                    updateConfig: plan.inspect.updateConfig,
                    rollbackConfig: plan.inspect.rollbackConfig,
                    endpointSpec: plan.inspect.endpointSpec,
                  });
                } catch (rollbackError) {
                  rollbackErrors.push(
                    `${plan.inspect.name}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
                  );
                }
              }
              if (rollbackErrors.length > 0) {
                throw new Error(
                  `Self-update failed and rollback failed: ${rollbackErrors.join("; ")}`,
                  { cause: error },
                );
              }
              throw new Error("Self-update failed and was rolled back", {
                cause: error,
              });
            }
          }

          if (updatedCount === 0) {
            log.warn({
              message:
                "No Upstand Swarm services found to update. Self-updates are supported in Docker Swarm mode.",
            });
            throw new Error(
              "No Docker Swarm services found for Upstand. Self-updates are only supported when deployed on Docker Swarm.",
            );
          }

          await this.notificationPublisher
            ?.execute({
              event: "platform_restart",
              idempotencyKey: `platform-restart:${version}`,
              title: "Upstand platform update started",
              message: `Upstand is applying version ${version} and will restart its services.`,
              metadata: { version, updatedServices: updatedCount },
            })
            .catch((error) => {
              log.error({
                message: "Unable to queue platform restart notification",
                err: error instanceof Error ? error.message : error,
              });
            });

          return { success: true };
        } catch (err: unknown) {
          log.error({
            message: `Self-update to ${version} failed`,
            err,
          });
          throw new Error(
            `Self-update failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    });

    if (result === null) {
      throw new Error("Another Upstand self-update is already in progress");
    }
    return result;
  }
}
