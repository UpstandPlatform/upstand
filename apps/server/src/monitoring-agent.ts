import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env } from "@upstand/env/server";
import { getDockerInstance } from "@upstand/infrastructure";
import { UnitOfWorkToken } from "@upstand/usecases/tokens";
import { log } from "evlog";
import { getServiceProvider } from "./di";

const MONITORING_IMAGE_ENV = "UPSTAND_MONITORING_IMAGE";
const MONITORING_CONTAINER_NAME = "upstand-monitoring-agent";
const MONITORING_IMAGE = "upstand-monitoring-agent:local";
const MONITORING_LABEL = "com.upstand.component";
const MONITORING_LABEL_VALUE = "monitoring-agent";

type MonitoringContainerInfo = {
  Config?: {
    Image?: string;
    Env?: string[];
    Labels?: Record<string, string>;
  };
  HostConfig?: {
    Binds?: string[];
    CapDrop?: string[];
    ExtraHosts?: string[];
    LogConfig?: { Config?: Record<string, string>; Type?: string };
    Memory?: number;
    NetworkMode?: string;
    PidsLimit?: number;
    PortBindings?: Record<
      string,
      Array<{ HostIp?: string; HostPort?: string }>
    >;
    ReadonlyRootfs?: boolean;
    RestartPolicy?: { Name?: string };
    SecurityOpt?: string[];
    Tmpfs?: Record<string, string>;
  };
  State?: { Running?: boolean };
};

type MonitoringContainerSpec = {
  Image: string;
  Env: string[];
  Labels: Record<string, string>;
  HostConfig: NonNullable<MonitoringContainerInfo["HostConfig"]>;
};

let monitoringInitializationPromise: Promise<void> | undefined;

export async function initializeMonitoring(): Promise<void> {
  if (!monitoringInitializationPromise) {
    monitoringInitializationPromise = initializeMonitoringOnce().catch(
      (error: unknown) => {
        monitoringInitializationPromise = undefined;
        log.error({
          message: "Failed to initialize local monitoring agent",
          err: error,
        });
      },
    );
  }

  return monitoringInitializationPromise;
}

async function initializeMonitoringOnce(): Promise<void> {
  const docker = getDockerInstance();
  const scope = getServiceProvider().createScope();
  let token = "";
  let cpuThreshold = 90;
  let memoryThreshold = 90;
  try {
    const uow = scope.resolve(UnitOfWorkToken);
    let settings =
      await uow.monitoringSettingsRepository.findByServerId("local");
    if (!settings) {
      settings = await uow.monitoringSettingsRepository.upsert({
        serverId: "local",
        token: randomBytes(24).toString("hex"),
        cpuThreshold: 90,
        memoryThreshold: 90,
      });
    }
    token = settings.token;
    cpuThreshold = settings.cpuThreshold;
    memoryThreshold = settings.memoryThreshold;
  } finally {
    await scope.dispose();
  }

  const monitoringImage = await resolveMonitoringImage(docker);
  await ensureImage(docker, monitoringImage);

  let networkMode: string | undefined;
  try {
    const me = docker.getContainer(os.hostname());
    const info = await me.inspect();
    const networks = Object.keys(info.NetworkSettings.Networks || {});
    networkMode = networks.find((n) => n !== "bridge") || networks[0];
  } catch (error: unknown) {
    const statusCode = dockerStatusCode(error);
    if (statusCode === 404) {
      log.info({
        message:
          "Monitoring agent running in host mode (not inside a Docker container)",
      });
    } else {
      log.warn({
        message: "Could not detect container network for monitoring agent",
        err: error,
      });
    }
  }

  const callbackHost = networkMode ? "upstand_server" : "host.docker.internal";
  const metricsConfig = {
    server: {
      serverId: "local",
      refreshRate: 25,
      port: 3001,
      serverType: "Upstand",
      token,
      urlCallback: `http://${callbackHost}:${env.PORT}/api/monitoring/alerts`,
      retentionDays: 7,
      cronJob: "0 0 * * *",
      thresholds: {
        cpu: cpuThreshold,
        memory: memoryThreshold,
      },
    },
    containers: {
      refreshRate: 25,
      services: {
        include: [],
        exclude: [],
      },
    },
  };

  const containerOpts = {
    name: MONITORING_CONTAINER_NAME,
    Labels: {
      [MONITORING_LABEL]: MONITORING_LABEL_VALUE,
      "com.upstand.platform": "true",
    },
    Env: [
      `METRICS_CONFIG=${JSON.stringify(metricsConfig)}`,
      "DB_PATH=/data/monitoring.db",
    ],
    Image: monitoringImage,
    HostConfig: {
      RestartPolicy: { Name: "always" },
      ...(networkMode
        ? { NetworkMode: networkMode }
        : {
            ExtraHosts: ["host.docker.internal:host-gateway"],
            PortBindings: {
              "3001/tcp": [{ HostIp: "127.0.0.1", HostPort: "3005" }],
            },
          }),
      Binds: [
        // The agent needs Docker API access for container metrics. The
        // read-only bind prevents filesystem writes but does not make the
        // Docker API read-only; the agent is therefore hardened separately
        // with dropped capabilities, no-new-privileges, and a read-only root.
        "/var/run/docker.sock:/var/run/docker.sock:ro",
        "/proc:/host/proc:ro",
        "/sys:/host/sys:ro",
        "/etc/os-release:/etc/os-release:ro",
        "upstand-monitoring-data:/data",
      ],
      CapDrop: ["ALL"],
      LogConfig: {
        Type: "json-file",
        Config: { "max-size": "10m", "max-file": "3" },
      },
      Memory: 256 * 1024 * 1024,
      PidsLimit: 128,
      ReadonlyRootfs: true,
      SecurityOpt: ["no-new-privileges:true"],
      Tmpfs: { "/tmp": "rw,noexec,nosuid,nodev,size=16m" },
    },
    ExposedPorts: {
      "3001/tcp": {},
    },
  };

  const container = docker.getContainer(MONITORING_CONTAINER_NAME);
  let existing: MonitoringContainerInfo | undefined;
  try {
    existing = (await container.inspect()) as MonitoringContainerInfo;
  } catch (error: unknown) {
    if (dockerStatusCode(error) !== 404) throw error;
  }

  if (existing) {
    const owned =
      existing.Config?.Labels?.[MONITORING_LABEL] === MONITORING_LABEL_VALUE ||
      existing.Config?.Image === monitoringImage;
    if (!owned) {
      throw new Error(
        `Docker container name '${MONITORING_CONTAINER_NAME}' is already in use by an unrelated container`,
      );
    }

    if (isMonitoringContainerCurrent(existing, containerOpts)) {
      if (!existing.State?.Running) {
        await container.start();
        log.info({
          message: "Local Monitoring Agent container restarted",
          image: monitoringImage,
          network: networkMode || "loopback",
        });
      } else {
        log.info({
          message: "Local Monitoring Agent container already running",
          image: monitoringImage,
          network: networkMode || "loopback",
        });
      }
      return;
    }

    await container.remove({ force: true });
  }

  try {
    await docker.createContainer(containerOpts);
  } catch (error: unknown) {
    // A separate process may have reconciled the same named container between
    // inspect and create. Reuse it only after validating its ownership/config.
    if (dockerStatusCode(error) !== 409) throw error;
    const concurrent = (await container.inspect()) as MonitoringContainerInfo;
    if (!isMonitoringContainerCurrent(concurrent, containerOpts)) throw error;
    if (!concurrent.State?.Running) await container.start();
    log.info({
      message: "Local Monitoring Agent container already reconciled",
      image: monitoringImage,
      network: networkMode || "loopback",
    });
    return;
  }

  await docker.getContainer(MONITORING_CONTAINER_NAME).start();
  log.info({
    message: "Local Monitoring Agent container started",
    image: monitoringImage,
    network: networkMode || "loopback",
  });
}

function dockerStatusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return undefined;
  }
  const statusCode = error.statusCode;
  return typeof statusCode === "number" ? statusCode : undefined;
}

function isMonitoringContainerCurrent(
  info: MonitoringContainerInfo,
  desired: MonitoringContainerSpec,
): boolean {
  const desiredHostConfig = desired.HostConfig;
  const actualHostConfig = info.HostConfig;
  if (
    info.Config?.Image !== desired.Image ||
    info.Config?.Labels?.[MONITORING_LABEL] !== MONITORING_LABEL_VALUE ||
    !sameStringSet(info.Config?.Env, desired.Env) ||
    !sameStringSet(actualHostConfig?.Binds, desiredHostConfig.Binds) ||
    actualHostConfig?.NetworkMode !== desiredHostConfig.NetworkMode ||
    actualHostConfig?.ReadonlyRootfs !== desiredHostConfig.ReadonlyRootfs ||
    actualHostConfig?.Memory !== desiredHostConfig.Memory ||
    actualHostConfig?.PidsLimit !== desiredHostConfig.PidsLimit ||
    !sameStringSet(actualHostConfig?.CapDrop, desiredHostConfig.CapDrop) ||
    !sameStringSet(
      actualHostConfig?.SecurityOpt,
      desiredHostConfig.SecurityOpt,
    ) ||
    !sameStringSet(
      actualHostConfig?.ExtraHosts,
      desiredHostConfig.ExtraHosts,
    ) ||
    JSON.stringify(actualHostConfig?.PortBindings ?? {}) !==
      JSON.stringify(desiredHostConfig.PortBindings ?? {}) ||
    JSON.stringify(actualHostConfig?.Tmpfs ?? {}) !==
      JSON.stringify(desiredHostConfig.Tmpfs ?? {}) ||
    actualHostConfig?.RestartPolicy?.Name !==
      desiredHostConfig.RestartPolicy?.Name ||
    actualHostConfig?.LogConfig?.Type !== desiredHostConfig.LogConfig?.Type ||
    JSON.stringify(actualHostConfig?.LogConfig?.Config ?? {}) !==
      JSON.stringify(desiredHostConfig.LogConfig?.Config ?? {})
  ) {
    return false;
  }
  return true;
}

function sameStringSet(
  actual: string[] | undefined,
  desired: string[] | undefined,
): boolean {
  return (
    JSON.stringify([...(actual ?? [])].sort()) ===
    JSON.stringify([...(desired ?? [])].sort())
  );
}

async function resolveMonitoringImage(
  docker: ReturnType<typeof getDockerInstance>,
) {
  const configured = env.UPSTAND_MONITORING_IMAGE?.trim();
  if (configured) return configured;

  if (env.NODE_ENV === "production") {
    throw new Error(`${MONITORING_IMAGE_ENV} is required in production`);
  }

  const monitoringPath = resolveDevelopmentMonitoringPath();
  if (!monitoringPath) {
    throw new Error(
      `${MONITORING_IMAGE_ENV} is not set and the monitoring source is unavailable`,
    );
  }
  if (!(await imageExists(docker, MONITORING_IMAGE))) {
    await buildDevelopmentMonitoringImage(docker, monitoringPath);
  }
  return MONITORING_IMAGE;
}

function resolveDevelopmentMonitoringPath(): string | null {
  const candidates = [
    path.join(process.cwd(), "apps", "monitoring"),
    path.join(process.cwd(), "..", "..", "apps", "monitoring"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function buildDevelopmentMonitoringImage(
  docker: ReturnType<typeof getDockerInstance>,
  monitoringPath: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    log.info({ message: "Building development monitoring agent image" });
    const tarProcess = spawn("tar", ["-cf", "-", "-C", monitoringPath, "."]);
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    tarProcess.on("error", fail);
    tarProcess.on("close", (code) => {
      if (code !== 0) fail(new Error(`tar exited with status ${code}`));
    });
    docker.buildImage(
      tarProcess.stdout,
      { t: MONITORING_IMAGE },
      (error, stream) => {
        if (error) return fail(error);
        if (!stream)
          return fail(new Error("No monitoring build stream returned"));
        docker.modem.followProgress(stream, (progressError) => {
          if (progressError) fail(progressError);
          else if (!settled) {
            settled = true;
            resolve();
          }
        });
      },
    );
  });
}

async function imageExists(
  docker: ReturnType<typeof getDockerInstance>,
  image: string,
): Promise<boolean> {
  try {
    await docker.getImage(image).inspect();
    return true;
  } catch (error: unknown) {
    if (dockerStatusCode(error) === 404) return false;
    throw error;
  }
}

async function ensureImage(
  docker: ReturnType<typeof getDockerInstance>,
  image: string,
): Promise<void> {
  if (await imageExists(docker, image)) return;

  log.info({ message: "Pulling monitoring agent image", image });
  const stream = await docker.pull(image);
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}
