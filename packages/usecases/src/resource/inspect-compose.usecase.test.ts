import { describe, expect, test } from "bun:test";
import { InspectComposeUseCase } from "./inspect-compose.usecase";

describe("Compose inspection", () => {
  const useCase = new InspectComposeUseCase();

  test("discovers services and resource relationships without deployment", async () => {
    const result = await useCase.execute({
      composeFile: `
services:
  web:
    image: nginx:alpine
    ports: ["8080:80"]
    depends_on: [api]
    healthcheck:
      test: [CMD, nginx, -t]
  api:
    build:
      context: ./api
    deploy:
      replicas: 3
volumes:
  data:
networks:
  internal:
`,
    });

    expect(result.services).toEqual([
      expect.objectContaining({
        name: "web",
        image: "nginx:alpine",
        ports: ["8080:80"],
        dependsOn: ["api"],
        healthcheck: true,
      }),
      expect.objectContaining({
        name: "api",
        image: null,
        replicas: 3,
      }),
    ]);
    expect(result.volumes).toEqual(["data"]);
    expect(result.networks).toEqual(["internal"]);
  });

  test("converts restart and fixed container names for a Swarm stack", async () => {
    const result = await useCase.convert({
      composeFile:
        "services:\n  web:\n    image: nginx\n    container_name: legacy-web\n    restart: unless-stopped\n",
      target: "stack",
    });

    expect(result.composeFile).not.toContain("container_name");
    expect(result.composeFile).toContain("restart_policy:");
    expect(result.composeFile).toContain("condition: any");
  });

  test("converts Swarm stack restart_policy to Docker Compose restart", async () => {
    const result = await useCase.convert({
      composeFile:
        "services:\n  web:\n    image: nginx\n    deploy:\n      restart_policy:\n        condition: on-failure\n",
      target: "compose",
    });

    expect(result.composeFile).not.toContain("restart_policy");
    expect(result.composeFile).toContain("restart: on-failure");
  });

  test("rejects malformed documents and documents without services", async () => {
    await expect(
      useCase.execute({ composeFile: "services: [" }),
    ).rejects.toThrow("Compose YAML is invalid");
    await expect(
      useCase.execute({ composeFile: "version: '3.9'" }),
    ).rejects.toThrow("at least one service");
  });
});
