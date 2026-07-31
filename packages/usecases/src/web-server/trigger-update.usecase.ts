import { env } from "@upstand/env/server";
import { log } from "evlog";
import { z } from "zod";
import type { NotificationPublisher } from "../notification/publish-notification.usecase";
import { requiresRemoteServerPlacement } from "../platform/platform.types";
import { getDockerInstance } from "../resource/docker-client";
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

export class TriggerUpdateUseCase {
  private readonly docker = getDockerInstance();

  constructor(private readonly notificationPublisher?: NotificationPublisher) {}

  async execute(input: TriggerUpdateInput): Promise<{ success: boolean }> {
    if (requiresRemoteServerPlacement()) {
      throw new Error(
        "Cloud Upstand instances are updated by the managed release rollout.",
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
    log.info({ message: `Triggering self-update to version ${version}...` });

    try {
      const services = await this.docker.listServices();
      let updatedCount = 0;

      for (const s of services) {
        const name = s.Spec?.Name || "";
        if (
          name === "upstand-server" ||
          name === "upstand-schedules" ||
          name === "upstand-web" ||
          name === "upstand-fumadocs" ||
          name === "upstand_server" ||
          name === "upstand_schedules" ||
          name === "upstand_web" ||
          name === "upstand_fumadocs"
        ) {
          const service = this.docker.getService(s.ID);
          const inspect = await service.inspect();
          const currentImage =
            inspect.Spec.TaskTemplate?.ContainerSpec?.Image || "";

          if (!currentImage) continue;

          if (currentImage.includes(":source-")) {
            throw new Error(
              "This installation was built from source. Run the GitHub installer to update it, or reinstall from a published release image.",
            );
          }

          let baseImage = currentImage;
          if (baseImage.includes("@sha256:")) {
            baseImage = baseImage.split("@sha256:")[0];
          }
          const digestSeparator = baseImage.lastIndexOf("@");
          if (digestSeparator >= 0)
            baseImage = baseImage.slice(0, digestSeparator);
          const tagSeparator = baseImage.lastIndexOf(":");
          if (tagSeparator > baseImage.lastIndexOf("/")) {
            baseImage = baseImage.slice(0, tagSeparator);
          }

          const imageName = name.includes("fumadocs")
            ? "fumadocs"
            : name.includes("schedules")
              ? "schedules"
              : name.includes("web")
                ? "web"
                : "server";

          if (!baseImage.includes("/") || baseImage.startsWith("upstand-")) {
            const repo = env.GITHUB_REPOSITORY;
            baseImage = `ghcr.io/${repo}-${imageName}`;
          }

          const newImage = `${baseImage}@${input.images[imageName]}`;
          const currentEnv = (inspect.Spec.TaskTemplate.ContainerSpec.Env ??
            []) as string[];
          let nextEnv = currentEnv.some((entry) =>
            entry.startsWith("UPSTAND_VERSION="),
          )
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
            const monitoringBaseImage = baseImage.replace(
              /-server$/,
              "-monitoring",
            );
            const monitoringImage = `${monitoringBaseImage}@${input.images.monitoring}`;
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
          log.info({
            message: `Updating Swarm service '${name}' to use image '${newImage}'...`,
          });

          await service.update({
            version: inspect.Version.Index,
            Name: name,
            TaskTemplate: {
              ...inspect.Spec.TaskTemplate,
              ContainerSpec: {
                ...inspect.Spec.TaskTemplate.ContainerSpec,
                Image: newImage,
                Env: nextEnv,
              },
              ForceUpdate: (inspect.Spec.TaskTemplate.ForceUpdate || 0) + 1,
            },
            UpdateConfig: inspect.Spec.UpdateConfig,
            RollbackConfig: inspect.Spec.RollbackConfig,
            EndpointSpec: inspect.Spec.EndpointSpec,
          });
          updatedCount++;
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
  }
}
