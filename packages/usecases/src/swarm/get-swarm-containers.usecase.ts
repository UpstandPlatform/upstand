import type Docker from "dockerode";
import { getDockerInstance } from "../resource/docker-client";
import { type DockerSwarmNode, requireActiveManager } from "./swarm.helpers";

interface DockerSwarmService {
  ID: string;
  Spec?: { Name?: string };
}

interface DockerSwarmTask {
  ID: string;
  ServiceID?: string;
  NodeID?: string;
  Slot?: number;
  DesiredState?: string;
  Status?: {
    State?: string;
    Message?: string;
    Err?: string;
    Timestamp?: string;
  };
  Spec?: { ContainerSpec?: { Image?: string } };
}

export interface SwarmContainerResult {
  id: string;
  serviceName: string;
  nodeName: string;
  slot: number;
  image: string;
  desiredState: string;
  currentState: string;
  message: string;
  updatedAt: string | null;
}

export interface SwarmContainersOverview {
  totalNodes: number;
  totalServices: number;
  runningTasks: number;
  pendingTasks: number;
  tasks: SwarmContainerResult[];
}

export class GetSwarmContainersUseCase {
  private readonly docker: Docker;

  constructor(docker?: Docker) {
    this.docker = docker || getDockerInstance();
  }

  async execute(): Promise<SwarmContainersOverview> {
    await requireActiveManager(this.docker);
    const [rawNodes, rawServices, rawTasks] = await Promise.all([
      this.docker.listNodes(),
      this.docker.listServices(),
      this.docker.listTasks(),
    ]);
    const nodes = rawNodes as DockerSwarmNode[];
    const services = rawServices as DockerSwarmService[];
    const tasks = rawTasks as DockerSwarmTask[];

    const nodeNames = new Map(
      nodes.map((node) => [
        node.ID,
        node.Description?.Hostname || node.Spec?.Name || node.ID,
      ]),
    );
    const serviceNames = new Map(
      services.map((service) => [service.ID, service.Spec?.Name || service.ID]),
    );

    const mappedTasks = tasks
      .map((task): SwarmContainerResult => {
        const image = task.Spec?.ContainerSpec?.Image || "unknown";
        return {
          id: task.ID,
          serviceName:
            serviceNames.get(task.ServiceID ?? "") ||
            task.ServiceID ||
            "unknown",
          nodeName: nodeNames.get(task.NodeID ?? "") || "unassigned",
          slot: task.Slot || 0,
          image: image.split("@sha256:")[0] || image,
          desiredState: task.DesiredState || "unknown",
          currentState: task.Status?.State || "unknown",
          message: task.Status?.Message || task.Status?.Err || "",
          updatedAt: task.Status?.Timestamp || null,
        };
      })
      .sort((left, right) => {
        const serviceOrder = left.serviceName.localeCompare(right.serviceName);
        if (serviceOrder !== 0) return serviceOrder;
        return left.slot - right.slot;
      });

    return {
      totalNodes: nodes.length,
      totalServices: services.length,
      runningTasks: mappedTasks.filter(
        (task) => task.currentState === "running",
      ).length,
      pendingTasks: mappedTasks.filter(
        (task) =>
          task.currentState === "pending" || task.currentState === "assigned",
      ).length,
      tasks: mappedTasks,
    };
  }
}
