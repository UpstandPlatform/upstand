import { describe, expect, test } from "bun:test";
import {
  buildEncryptedUpstandNetworkCommand,
  buildMonitoringAgentContainerCommand,
} from "./setup-server.usecase";

describe("remote monitoring agent provisioning", () => {
  test("creates or validates an encrypted shared overlay network", () => {
    const command = buildEncryptedUpstandNetworkCommand();

    expect(command).toContain("--driver overlay --opt encrypted --attachable");
    expect(command).toContain("{{json .Options}}");
    expect(command).toContain("existing Upstand network must be encrypted");
  });

  test("inspects only containers when the development image shares the container name", () => {
    const command = buildMonitoringAgentContainerCommand({
      containerName: "upstand-monitoring-agent",
      monitoringImage: "upstand-monitoring-agent",
      metricsConfigPath: "/tmp/upstand-monitoring-config-test.env",
      dockerSocketGid: "998",
    });

    expect(command).toContain(
      "docker container inspect 'upstand-monitoring-agent'",
    );
    expect(command).toContain(
      "docker container rm -f 'upstand-monitoring-agent'",
    );
    expect(command).not.toMatch(/(?:^|\s)docker inspect(?:\s|$)/);
    expect(command).toContain(
      "--env-file '/tmp/upstand-monitoring-config-test.env'",
    );
    expect(command).toContain("--group-add '998'");
    expect(command).not.toContain("METRICS_CONFIG=");
  });

  test("rejects an unsafe Docker socket group ID", () => {
    expect(() =>
      buildMonitoringAgentContainerCommand({
        containerName: "upstand-monitoring-agent",
        monitoringImage: "upstand-monitoring-agent",
        metricsConfigPath: "/tmp/upstand-monitoring-config-test.env",
        dockerSocketGid: "998; rm -rf /",
      }),
    ).toThrow("Remote Docker socket group ID must be numeric");
  });
});
