import { describe, expect, test } from "bun:test";
import { buildMonitoringAgentContainerCommand } from "./setup-server.usecase";

describe("remote monitoring agent provisioning", () => {
  test("inspects only containers when the development image shares the container name", () => {
    const command = buildMonitoringAgentContainerCommand({
      containerName: "upstand-monitoring-agent",
      monitoringImage: "upstand-monitoring-agent",
      metricsConfig: { server: { serverId: "server-1" } },
    });

    expect(command).toContain(
      "docker container inspect 'upstand-monitoring-agent'",
    );
    expect(command).toContain(
      "docker container rm -f 'upstand-monitoring-agent'",
    );
    expect(command).not.toMatch(/(?:^|\s)docker inspect(?:\s|$)/);
  });
});
