import { describe, expect, test } from "bun:test";
import { DockerCleanupService } from "./docker-cleanup.service";

describe("DockerCleanupService", () => {
  test("runs the full cleanup as separate argument-safe Docker commands", async () => {
    const calls: string[][] = [];
    const service = new DockerCleanupService(async (args) => {
      calls.push(args);
      return { stdout: "ok", stderr: "" };
    });

    const result = await service.run("all", {
      DOCKER_HOST: "ssh://remote",
    });

    expect(result.action).toBe("all");
    expect(calls).toEqual([
      ["container", "prune", "--force"],
      [
        "image",
        "prune",
        "--all",
        "--force",
        "--filter",
        "label!=com.upstand.rollback.keep=true",
      ],
      ["volume", "prune", "--all", "--force"],
      ["builder", "prune", "--all", "--force"],
      [
        "system",
        "prune",
        "--all",
        "--force",
        "--filter",
        "label!=com.upstand.rollback.keep=true",
      ],
    ]);
  });

  test("does not interpolate cleanup action input into a shell", async () => {
    const calls: string[][] = [];
    const service = new DockerCleanupService(async (args) => {
      calls.push(args);
      return { stdout: "", stderr: "" };
    });

    await service.run("images");

    expect(calls).toEqual([
      [
        "image",
        "prune",
        "--all",
        "--force",
        "--filter",
        "label!=com.upstand.rollback.keep=true",
      ],
    ]);
  });

  test("can explicitly prune rollback images and networks", async () => {
    const calls: string[][] = [];
    const service = new DockerCleanupService(async (args) => {
      calls.push(args);
      return { stdout: "", stderr: "" };
    });

    await service.run(
      "all",
      {},
      {
        preserveRollbackImages: false,
        pruneNetworks: true,
      },
    );

    expect(calls).toEqual([
      ["container", "prune", "--force"],
      ["image", "prune", "--all", "--force"],
      ["volume", "prune", "--all", "--force"],
      ["builder", "prune", "--all", "--force"],
      ["system", "prune", "--all", "--force"],
      ["network", "prune", "--force"],
    ]);
  });

  test("stops the full cleanup and propagates the failing Docker command", async () => {
    const calls: string[][] = [];
    const failure = new Error("Docker daemon is unavailable");
    const service = new DockerCleanupService(async (args) => {
      calls.push(args);
      if (args[0] === "image") throw failure;
      return { stdout: "ok", stderr: "" };
    });

    await expect(service.run("all")).rejects.toBe(failure);
    expect(calls).toEqual([
      ["container", "prune", "--force"],
      [
        "image",
        "prune",
        "--all",
        "--force",
        "--filter",
        "label!=com.upstand.rollback.keep=true",
      ],
    ]);
  });
});
