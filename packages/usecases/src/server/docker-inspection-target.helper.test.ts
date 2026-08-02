import { describe, expect, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import { resolveDockerInspectionTarget } from "./docker-inspection-target.helper";

function createUow() {
  return {} as IUnitOfWork;
}

describe("resolveDockerInspectionTarget", () => {
  test("resolves local target when not in cloud mode", async () => {
    const target = await resolveDockerInspectionTarget(createUow(), {
      organizationId: "org-1",
      serverId: "local",
    });
    expect(target).toEqual({ kind: "local", name: "Local Docker" });
  });

  test("treats the manager alias as the local target", async () => {
    const target = await resolveDockerInspectionTarget(createUow(), {
      organizationId: "org-1",
      serverId: "manager",
    });

    expect(target).toEqual({ kind: "local", name: "Local Docker" });
  });

  test("rejects local target when in cloud mode", async () => {
    const originalIsCloud = process.env.IS_CLOUD;
    process.env.IS_CLOUD = "true";
    try {
      await expect(
        resolveDockerInspectionTarget(createUow(), {
          organizationId: "org-1",
          serverId: "local",
        }),
      ).rejects.toThrow(
        "Local server target is not available in cloud mode. Please specify a remote server ID.",
      );
    } finally {
      process.env.IS_CLOUD = originalIsCloud;
    }
  });

  test("allows local target in cloud mode when allowLocalInCloud option is set", async () => {
    const originalIsCloud = process.env.IS_CLOUD;
    process.env.IS_CLOUD = "true";
    try {
      const target = await resolveDockerInspectionTarget(
        createUow(),
        {
          organizationId: "org-1",
          serverId: "local",
        },
        { allowLocalInCloud: true },
      );
      expect(target).toEqual({ kind: "local", name: "Local Docker" });
    } finally {
      process.env.IS_CLOUD = originalIsCloud;
    }
  });
});
