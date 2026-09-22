import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DetectApplicationBuildUseCase } from "./detect-application-build.usecase";

describe("DetectApplicationBuildUseCase", () => {
  test("uses the same detector contract as deployment for a local application", async () => {
    const projectPath = await mkdtemp(
      path.join(os.tmpdir(), "upstand-detect-build-"),
    );
    try {
      await writeFile(
        path.join(projectPath, "package.json"),
        JSON.stringify({
          scripts: { build: "bun run build", start: "bun run start" },
          dependencies: { next: "15.0.0" },
        }),
      );
      await writeFile(path.join(projectPath, "bun.lock"), "");

      const useCase = new DetectApplicationBuildUseCase({
        resourceRepository: {
          findById: async () => ({ type: "application", provider: "local" }),
        },
      } as never);

      const result = await useCase.execute({
        resourceId: "application-1",
        localPath: projectPath,
      });

      expect(result.status).toBe("detected");
      expect(result.strategy).toBe("framework");
      expect(result.packageManager).toBe("bun");
      expect(result.commands.build).toBe("bun run build");
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  test("supports previewing a local draft before its provider is saved", async () => {
    const projectPath = await mkdtemp(
      path.join(os.tmpdir(), "upstand-detect-build-draft-"),
    );
    try {
      await writeFile(
        path.join(projectPath, "package.json"),
        JSON.stringify({ scripts: { build: "npm run build" } }),
      );

      const useCase = new DetectApplicationBuildUseCase({
        resourceRepository: {
          findById: async () => ({ type: "application", provider: "github" }),
        },
      } as never);

      const result = await useCase.execute({
        resourceId: "application-1",
        localPath: projectPath,
      });

      expect(result.status).toBe("detected");
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  test("rejects build previews for non-application resources", async () => {
    const useCase = new DetectApplicationBuildUseCase({
      resourceRepository: {
        findById: async () => ({ type: "database", provider: "postgres" }),
      },
    } as never);

    await expect(
      useCase.execute({
        resourceId: "application-1",
        localPath: "C:\\Projects\\app",
      }),
    ).rejects.toThrow("Application not found");
  });
});
