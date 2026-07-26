import {
  getDockerInstance,
  type NotificationPublisher,
} from "@upstand/usecases";
import { PublishNotificationUseCaseToken } from "@upstand/usecases/tokens";
import { z } from "zod";
import type { AuthenticatedContext } from "../context";
import { getErrorMessage } from "../errors";
import { requireInstanceOwnerContext } from "../instance-access";

export async function queueDockerCleanupNotification(
  publisher: NotificationPublisher,
  logger: Pick<AuthenticatedContext["log"], "error">,
  input: {
    success: boolean;
    organizationId?: string;
    title: string;
    message: string;
    metadata?: Record<string, unknown>;
    idempotencyKey?: string;
  },
): Promise<void> {
  await publisher
    .execute({
      event: input.success
        ? "docker_cleanup_completed"
        : "docker_cleanup_failed",
      organizationId: input.organizationId,
      title: input.title,
      message: input.message,
      metadata: {
        ...input.metadata,
        event: input.success
          ? "docker_cleanup_completed"
          : "docker_cleanup_failed",
      },
      idempotencyKey: input.idempotencyKey,
    })
    .catch((error) => {
      logger.error(error instanceof Error ? error : String(error), {
        message: "Unable to queue Docker cleanup notification",
      });
    });
}

export function cleanDockerLogs(buffer: Buffer): string {
  let result = "";
  let offset = 0;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) break;
    const size = buffer.readUInt32BE(offset + 4);
    offset += 8;

    if (offset + size > buffer.length) {
      result += buffer.toString("utf8", offset);
      break;
    }

    result += buffer.toString("utf8", offset, offset + size);
    offset += size;
  }
  return result || buffer.toString("utf8");
}

export async function dockerLogBuffer(logs: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(logs)) return logs;
  if (
    !logs ||
    typeof logs !== "object" ||
    !("getReader" in logs) ||
    typeof logs.getReader !== "function"
  ) {
    throw new Error("Docker returned an unsupported logs stream");
  }
  const reader = logs.getReader() as {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    releaseLock(): void;
  };
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export const UPSTAND_SERVER_SERVICE = "upstand_server";
export const UPSTAND_REDIS_SERVICE = "upstand_redis";
export const CleanupInputSchema = z.object({
  organizationId: z.string().min(1),
  confirm: z.literal("CLEANUP"),
  preserveRollbackImages: z.boolean().default(true),
  pruneNetworks: z.boolean().default(false),
});

export type DockerCleanupCommand =
  | "images"
  | "volumes"
  | "containers"
  | "builder"
  | "system"
  | "all";

function dockerCleanupCommands(
  command: DockerCleanupCommand,
  options: { preserveRollbackImages?: boolean; pruneNetworks?: boolean },
): string[][] {
  const preserveRollbackImages = options.preserveRollbackImages !== false;
  const imageFilter = preserveRollbackImages
    ? ["--filter", "label!=com.upstand.rollback.keep=true"]
    : [];
  const actions: Record<Exclude<DockerCleanupCommand, "all">, string[]> = {
    images: ["image", "prune", "--all", "--force", ...imageFilter],
    volumes: ["volume", "prune", "--all", "--force"],
    containers: ["container", "prune", "--force"],
    builder: ["builder", "prune", "--all", "--force"],
    system: ["system", "prune", "--all", "--force", ...imageFilter],
  };
  if (command !== "all") return [actions[command]];
  return [
    actions.containers,
    actions.images,
    actions.volumes,
    actions.builder,
    actions.system,
    ...(options.pruneNetworks ? [["network", "prune", "--force"]] : []),
  ];
}

export async function requireWebServerOwner(
  ctx: AuthenticatedContext,
): Promise<void> {
  await requireInstanceOwnerContext(ctx);
}

export async function runDockerCleanup(
  ctx: AuthenticatedContext,
  command: DockerCleanupCommand,
  failureMessage: string,
  organizationId: string,
  options: {
    preserveRollbackImages?: boolean;
    pruneNetworks?: boolean;
  } = {},
): Promise<{ success: true }> {
  await requireInstanceOwnerContext(ctx);
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const publisher = ctx.scope.resolve(PublishNotificationUseCaseToken);
  try {
    for (const args of dockerCleanupCommands(command, options)) {
      await execFileAsync("docker", args, {
        maxBuffer: 2 * 1024 * 1024,
      });
    }
    await queueDockerCleanupNotification(publisher, ctx.log, {
      success: true,
      organizationId,
      title: "🧹 Docker cleanup completed",
      message: "Upstand completed a Docker cleanup operation.",
    });
    return { success: true };
  } catch (error) {
    const message = getErrorMessage(error, failureMessage);
    await queueDockerCleanupNotification(publisher, ctx.log, {
      success: false,
      organizationId,
      title: "🧹 Docker cleanup failed",
      message,
      metadata: { error: message },
    });
    throw new Error(message);
  }
}

type DockerExecution = {
  start(options: Record<string, never>): Promise<DockerStream>;
  inspect(): Promise<{ ExitCode?: number | null }>;
};

type DockerStream = {
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
};

export type ManagedContainer = {
  logs(options: {
    stdout: boolean;
    stderr: boolean;
    tail: number;
  }): Promise<unknown>;
  exec(options: {
    Cmd: string[];
    AttachStdout: boolean;
    AttachStderr: boolean;
  }): Promise<DockerExecution>;
};

export async function getRunningServiceContainer(
  serviceName: string,
): Promise<ManagedContainer> {
  const docker = getDockerInstance();
  const tasks = await docker.listTasks({
    filters: JSON.stringify({
      service: [serviceName],
      "desired-state": ["running"],
    }),
  });
  const task = tasks.find(
    (candidate) =>
      candidate.Status?.State === "running" &&
      candidate.Status?.ContainerStatus?.ContainerID,
  );
  const containerId = task?.Status?.ContainerStatus?.ContainerID;
  if (!containerId) {
    throw new Error(`No running task is available for ${serviceName}`);
  }
  const container = docker.getContainer(containerId);
  return {
    logs: (options) => container.logs(options),
    exec: async (options) => {
      const execution = await container.exec(options);
      return {
        start: () => execution.start({}),
        inspect: async () => {
          const result = await execution.inspect();
          return { ExitCode: result.ExitCode };
        },
      };
    },
  };
}

export async function forceServiceUpdate(serviceName: string): Promise<void> {
  const docker = getDockerInstance();
  const service = docker.getService(serviceName);
  const inspect = await service.inspect();
  const taskTemplate = inspect.Spec.TaskTemplate;
  if (!taskTemplate) throw new Error(`Service ${serviceName} has no task spec`);

  await service.update({
    version: inspect.Version.Index,
    Name: inspect.Spec.Name,
    TaskTemplate: {
      ...taskTemplate,
      ForceUpdate: (taskTemplate.ForceUpdate || 0) + 1,
    },
    Mode: inspect.Spec.Mode,
    UpdateConfig: inspect.Spec.UpdateConfig,
    RollbackConfig: inspect.Spec.RollbackConfig,
    Networks: inspect.Spec.Networks,
    EndpointSpec: inspect.Spec.EndpointSpec,
  });
}

export async function execInContainer(
  container: ManagedContainer,
  command: string[],
): Promise<void> {
  const execution = await container.exec({
    Cmd: command,
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await execution.start({});
  await new Promise<void>((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  const result = await execution.inspect();
  if (result.ExitCode !== 0) {
    throw new Error(
      `Command '${command[0]}' failed with exit code ${result.ExitCode}`,
    );
  }
}

export async function getRedisPassword(): Promise<string> {
  const service = getDockerInstance().getService(UPSTAND_REDIS_SERVICE);
  const inspect = await service.inspect();
  const entry = inspect.Spec.TaskTemplate?.ContainerSpec?.Env?.find(
    (value: string) => value.startsWith("REDIS_PASSWORD="),
  );
  const password = entry?.slice("REDIS_PASSWORD=".length);
  if (!password)
    throw new Error("Redis password is not configured on the service");
  return password;
}

export async function checkGpuStatus() {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);

  let driverInstalled = false;
  let driverVersion: string | undefined;
  let gpuModel: string | undefined;
  let memoryInfo: string | undefined;
  let runtimeInstalled = false;
  let runtimeConfigured = false;
  let cudaSupport = false;
  let cudaVersion: string | undefined;
  let swarmEnabled = false;
  let gpuResources = 0;

  try {
    const { stdout } = await execAsync(
      "nvidia-smi --query-gpu=driver_version --format=csv,noheader",
    );
    driverVersion = stdout.trim();
    driverInstalled = !!driverVersion;
  } catch {}

  if (driverInstalled) {
    try {
      const { stdout } = await execAsync(
        "nvidia-smi --query-gpu=gpu_name,memory.total --format=csv,noheader",
      );
      const parts = stdout.split(",");
      gpuModel = parts[0]?.trim();
      memoryInfo = parts[1]?.trim();
    } catch {}

    try {
      const { stdout } = await execAsync("nvidia-smi -q");
      const match = stdout.match(/CUDA Version\s*:\s*([\d.]+)/);
      if (match) {
        cudaVersion = match[1];
        cudaSupport = true;
      }
    } catch {}
  }

  try {
    const { stdout } = await execAsync("command -v nvidia-container-runtime");
    runtimeInstalled = !!stdout.trim();
  } catch {}

  try {
    const { stdout } = await execAsync(
      'docker info --format "{{json .Runtimes}}"',
    );
    const runtimes = JSON.parse(stdout);
    runtimeConfigured = "nvidia" in runtimes;
  } catch {}

  try {
    const { stdout } = await execAsync(
      "docker node inspect self --format '{{json .Description.Resources.GenericResources}}'",
    );
    if (stdout && stdout.trim() !== "null") {
      const generic = JSON.parse(stdout);
      for (const res of generic) {
        if (
          res.DiscreteResourceSpec &&
          (res.DiscreteResourceSpec.Kind === "GPU" ||
            res.DiscreteResourceSpec.Kind === "gpu")
        ) {
          gpuResources = res.DiscreteResourceSpec.Value;
          swarmEnabled = true;
          break;
        }
      }
    }
  } catch {}

  return {
    driverInstalled,
    driverVersion,
    gpuModel,
    memoryInfo,
    runtimeInstalled,
    runtimeConfigured,
    cudaSupport,
    cudaVersion,
    availableGPUs: driverInstalled ? 1 : 0,
    swarmEnabled,
    gpuResources,
  };
}

export async function setupGpuSupport() {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);

  const status = await checkGpuStatus();
  if (!status.driverInstalled) {
    throw new Error(
      "NVIDIA driver not found. Please install NVIDIA drivers before configuring GPU support.",
    );
  }
  const daemonConfig = {
    runtimes: {
      nvidia: {
        path: "nvidia-container-runtime",
        runtimeArgs: [],
      },
    },
    "default-runtime": "nvidia",
  };

  const setupCommands = [
    `echo '${JSON.stringify(daemonConfig, null, 2)}' | sudo tee /etc/docker/daemon.json`,
    "sudo systemctl daemon-reload",
    "sudo systemctl restart docker",
  ].join(" && ");

  await execAsync(setupCommands);
}
