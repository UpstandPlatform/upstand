import type { DockerSwarmManagementPort } from "../ports/swarm";
import { assertActiveManager } from "./swarm.helpers";

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
  private readonly docker: DockerSwarmManagementPort;

  constructor(docker: DockerSwarmManagementPort) {
    this.docker = docker;
  }

  async execute(): Promise<SwarmContainersOverview> {
    const info = await this.docker.getInfo();
    assertActiveManager(info);
    const [nodes, services, tasks] = await Promise.all([
      this.docker.listNodes(),
      this.docker.listServices(),
      this.docker.listTasks(),
    ]);

    const nodeNames = new Map(nodes.map((node) => [node.id, node.hostname]));
    const serviceNames = new Map(
      services.map((service) => [service.id, service.name]),
    );

    const mappedTasks = tasks
      .map((task): SwarmContainerResult => {
        const image = task.image || "unknown";
        return {
          id: task.id,
          serviceName:
            serviceNames.get(task.serviceId ?? "") ||
            task.serviceId ||
            "unknown",
          nodeName: nodeNames.get(task.nodeId ?? "") || "unassigned",
          slot: task.slot,
          image: image.split("@sha256:")[0] || image,
          desiredState: task.desiredState,
          currentState: task.currentState,
          message: task.message,
          updatedAt: task.updatedAt,
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
