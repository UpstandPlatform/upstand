import { describe, expect, test } from "bun:test";
import type { ControlPlaneMode } from "@upstand/usecases";
import { createDeploymentPipelineFixture } from "./support/deployment-pipeline-fixture";

const runtimeModes: ControlPlaneMode[] = ["self-hosted", "cloud", "desktop"];

describe("Upstand deployment pipeline fixtures", () => {
  for (const mode of runtimeModes) {
    test(`deploys application, Compose, and database resources in ${mode} mode`, async () => {
      const fixture = await createDeploymentPipelineFixture(mode);

      expect(fixture.project.organizationId).toBe("org-fixture");
      expect(fixture.environment.projectId).toBe(fixture.project.id);
      expect(fixture.applicationServer.status).toBe("ready");
      expect(fixture.databaseServer.serverType).toBe("database");

      await fixture.runDeployment(
        fixture.application.id,
        `${mode}-application-first`,
        "a1b2c3d4e5f67890",
      );
      await fixture.runDeployment(
        fixture.compose.id,
        `${mode}-compose-first`,
        "b1c2d3e4f5a67890",
      );
      await fixture.runDeployment(
        fixture.database.id,
        `${mode}-database-first`,
        "c1d2e3f4a5b67890",
      );
      await fixture.runDeployment(
        fixture.application.id,
        `${mode}-application-redeploy`,
        "d1e2f3a4b5c67890",
      );

      const firstDeployment = fixture.deployments.get(
        `${mode}-application-first`,
      );
      expect(firstDeployment?.status).toBe("success");
      expect(firstDeployment?.sourceRevision).toBe("a1b2c3d4e5f67890");
      expect(firstDeployment?.deploymentPlan).toMatchObject({
        target: {
          kind: "remote-server",
          serverId: fixture.applicationServer.id,
        },
        runtime: "docker",
        buildLocation: { kind: "control-plane" },
        ownership:
          mode === "cloud" ? "cloud-control-plane" : "local-control-plane",
        artifact: { digest: `sha256:${"d".repeat(64)}` },
      });
      expect(firstDeployment?.logs).toContain(
        "Pipeline completed successfully",
      );
      expect(firstDeployment?.logs).toContain(
        "[upstand.json] Synced runtime/resource configuration",
      );
      expect(firstDeployment?.logs).toContain(
        "[Plan] Locked remote-server/docker",
      );

      expect(fixture.deployments.get(`${mode}-compose-first`)?.status).toBe(
        "success",
      );
      expect(fixture.deployments.get(`${mode}-database-first`)?.status).toBe(
        "success",
      );
      expect(
        fixture.deployments.get(`${mode}-application-redeploy`)?.status,
      ).toBe("success");
      expect(fixture.outbox.size).toBe(4);
      expect(fixture.buildLocations).toEqual([
        "control-plane-to-remote",
        "control-plane-to-remote",
      ]);
      expect(fixture.schedules.size).toBe(1);
      expect([...fixture.schedules.values()][0]).toMatchObject({
        name: "Fixture health check",
        source: "upstand.json",
        command: "/health",
      });

      const applicationState = fixture.serverStates.get(
        fixture.applicationServer.id,
      );
      const databaseState = fixture.serverStates.get(fixture.databaseServer.id);
      expect(applicationState?.services.get(fixture.application.id)).toEqual({
        kind: "application",
        image: `ghcr.io/upstand/${fixture.application.appName}:fixture`,
        status: "running",
      });
      expect(applicationState?.services.get(fixture.compose.id)?.kind).toBe(
        "compose",
      );
      expect(databaseState?.services.get(fixture.database.id)).toMatchObject({
        kind: "database",
        image: "postgres:18-alpine",
        status: "running",
      });
      expect(applicationState?.generatedCaddyConfig).toContain(
        "fixture-node.example.com",
      );
      expect(applicationState?.generatedCaddyConfig).toContain(
        "client_ip 198.51.100.9/32",
      );
      expect(applicationState?.generatedCaddyConfig).toContain(
        "respond @upstand_blocked_ip_",
      );
      expect(applicationState?.generatedCaddyConfig).toContain(
        "header_regexp User-Agent",
      );
      expect(applicationState?.generatedCaddyConfig).toContain(
        "respond @upstand_blocked_user_agent_",
      );
      expect(applicationState?.generatedCaddyConfig).toContain(
        "not method GET HEAD POST",
      );
      expect(applicationState?.generatedCaddyConfig).toContain(
        'Allow "GET, HEAD, POST"',
      );
      expect(applicationState?.generatedCaddyConfig).toMatch(
        /respond @upstand_disallowed_method_[\w]+ "Method Not Allowed" 405/,
      );
      expect(applicationState?.generatedCaddyConfig).toContain(
        "not header User-Agent *",
      );
      expect(applicationState?.generatedCaddyConfig).toContain(
        'header User-Agent ""',
      );
      expect(applicationState?.generatedCaddyConfig).toMatch(
        /respond @upstand_missing_user_agent_[\w]+ "Forbidden" 403/,
      );
      expect(applicationState?.generatedCaddyConfig).toMatch(
        /respond @upstand_empty_user_agent_[\w]+ "Forbidden" 403/,
      );
      expect(applicationState?.generatedCaddyConfig).toContain(
        "@upstand_external_referer_",
      );
      expect(applicationState?.generatedCaddyConfig).toContain(
        "not header_regexp upstand_referer_",
      );
      expect(applicationState?.generatedCaddyConfig).toContain(
        "respond @upstand_external_referer_",
      );
      expect(applicationState?.generatedCaddyConfig).toContain(
        "fixture-stack.example.com",
      );
      expect(fixture.notifications).toHaveLength(4);

      const rolledBack = await fixture.rollbackApplication();
      expect(rolledBack.status).toBe("running");
      expect(fixture.deployments.get(`${mode}-application-first`)?.status).toBe(
        "success",
      );
      expect(
        [...fixture.deployments.values()].some(
          (deployment) =>
            deployment.title === "Swarm service rollback" &&
            deployment.status === "success",
        ),
      ).toBe(true);
      expect(
        applicationState?.services.get(fixture.application.id)?.status,
      ).toBe("rolled-back");
    });
  }
});
