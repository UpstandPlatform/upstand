import { describe, expect, test } from "bun:test";
import {
  DockerService,
  redactCommandOutput,
  shouldSuppressComposeRestart,
} from "./docker.service";

describe("deployment command log safety", () => {
  test("redacts build and registry secrets without leaking shorter values", () => {
    expect(
      redactCommandOutput("token=super-secret and token=secret", [
        "secret",
        "super-secret",
      ]),
    ).toBe("token=[REDACTED] and token=[REDACTED]");
  });

  test("does not include secret-bearing command arguments in the failure format", () => {
    expect(
      redactCommandOutput("docker login --password-stdin registry.example", [
        "registry-password",
      ]),
    ).not.toContain("registry-password");
  });

  test("suppresses restart-policy recreation only for standalone Compose kill", () => {
    expect(
      shouldSuppressComposeRestart(
        { type: "compose", composeType: "compose" },
        "kill",
      ),
    ).toBe(true);
    expect(
      shouldSuppressComposeRestart(
        { type: "compose", composeType: "stack" },
        "kill",
      ),
    ).toBe(false);
    expect(
      shouldSuppressComposeRestart(
        { type: "application", composeType: null },
        "kill",
      ),
    ).toBe(false);
  });

  test("marks images from builders without native label flags for rollback", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const service = new DockerService({} as never) as unknown as {
      markImageForRollback: (
        imageName: string,
        onLog: (message: string) => void,
      ) => Promise<void>;
      runCommandAsync: (
        command: string,
        args: string[],
        onLog: (message: string) => void,
      ) => Promise<void>;
    };
    service.runCommandAsync = async (command, args) => {
      calls.push({ command, args });
    };

    await service.markImageForRollback("upstand-app-resource:latest", () => {});

    const createArgs = calls[0]?.args;
    const commitArgs = calls[1]?.args;
    const markerImage = commitArgs?.[4];
    const containerName = createArgs?.[2];
    if (typeof markerImage !== "string" || typeof containerName !== "string") {
      throw new Error("Rollback marker command was not recorded");
    }
    expect(createArgs?.[0]).toBe("create");
    expect(commitArgs).toEqual([
      "commit",
      "--change",
      "LABEL com.upstand.rollback.keep=true",
      containerName,
      markerImage,
    ]);
    expect(calls[2]?.args).toEqual([
      "tag",
      markerImage,
      "upstand-app-resource:latest",
    ]);
    expect(calls[3]?.args).toEqual(["rm", "--force", containerName]);
    expect(calls[4]?.args).toEqual(["image", "rm", markerImage]);
  });

  test("skips the post-deploy smoke test when it is disabled", async () => {
    const service = new DockerService({} as never);
    const result = await service.runPostDeploySmokeTest(
      { advancedConfig: "{}" } as never,
      () => {},
    );
    expect(result).toBeNull();
  });

  test("always drops all capabilities when applying advanced config", () => {
    const service = new DockerService({} as never) as unknown as {
      applyAdvancedConfig: (
        resource: unknown,
        containerSpec: Record<string, unknown>,
        taskTemplate: Record<string, unknown>,
        endpointSpec: Record<string, unknown>,
      ) => void;
    };
    const containerSpec: Record<string, unknown> = {};

    service.applyAdvancedConfig(
      {
        advancedConfig: JSON.stringify({
          capDrop: ["NET_BIND_SERVICE"],
        }),
      },
      containerSpec,
      {},
      {},
    );

    expect(containerSpec).toMatchObject({
      Privileged: false,
      SecurityOpt: ["no-new-privileges:true"],
      CapDrop: ["ALL", "NET_BIND_SERVICE"],
    });
  });
});
