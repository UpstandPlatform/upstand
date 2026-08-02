import { describe, expect, test } from "bun:test";
import { GetDeploymentsUseCase } from "./get-deployments.usecase";

describe("GetDeploymentsUseCase", () => {
  test("scopes organization history to resources owned by that organization", async () => {
    const requestedResourceIds: string[][] = [];
    const uow = {
      projectRepository: {
        async findByOrganizationId(organizationId: string) {
          return organizationId === "org-a"
            ? [{ id: "project-a" }]
            : [{ id: "project-b" }];
        },
        async findById(id: string) {
          return id === "project-a" ? { id, name: "Project A" } : null;
        },
      },
      environmentRepository: {
        async findByProjectId(projectId: string) {
          return [
            {
              id: `${projectId}-environment`,
              projectId,
            },
          ];
        },
        async findById(id: string) {
          return id === "project-a-environment"
            ? { id, projectId: "project-a", name: "Production" }
            : null;
        },
      },
      resourceRepository: {
        async findByEnvironmentId(environmentId: string) {
          return environmentId === "project-a-environment"
            ? [
                {
                  id: "resource-a",
                  environmentId,
                  name: "App A",
                  type: "application",
                },
              ]
            : [
                {
                  id: "resource-b",
                  environmentId,
                  name: "App B",
                  type: "application",
                },
              ];
        },
        async findById(id: string) {
          return id === "resource-a"
            ? {
                id,
                environmentId: "project-a-environment",
                name: "App A",
                type: "application",
              }
            : null;
        },
      },
      deploymentRepository: {
        async findRecentByResourceIds(resourceIds: readonly string[]) {
          requestedResourceIds.push([...resourceIds]);
          return resourceIds.includes("resource-a")
            ? [
                {
                  id: "deployment-a",
                  resourceId: "resource-a",
                  title: "Deploy A",
                  status: "success",
                  logs: "",
                  createdAt: new Date("2026-01-01T00:00:00.000Z"),
                  serverId: null,
                  serverName: null,
                },
              ]
            : [];
        },
      },
    };

    const result = await new GetDeploymentsUseCase(
      uow as never,
    ).executeForOrganization("org-a");

    expect(requestedResourceIds).toEqual([["resource-a"]]);
    expect(result.map((deployment) => deployment.resourceId)).toEqual([
      "resource-a",
    ]);
  });
});
