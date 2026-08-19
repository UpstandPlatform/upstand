import { describe, expect, test } from "bun:test";
import { cleanupUpdateArtifacts } from "./trigger-update.usecase";

describe("cleanupUpdateArtifacts", () => {
  test("cleans images and builder artifacts without touching volumes", async () => {
    const actions: string[] = [];

    await cleanupUpdateArtifacts(
      {
        run: async (action) => {
          actions.push(action);
          return { action, output: [] };
        },
      },
      "v0.2.23",
    );

    expect(actions).toEqual(["images", "builder"]);
  });

  test("continues when one cleanup action fails", async () => {
    const actions: string[] = [];

    await cleanupUpdateArtifacts(
      {
        run: async (action) => {
          actions.push(action);
          if (action === "images") throw new Error("Docker unavailable");
          return { action, output: [] };
        },
      },
      "v0.2.23",
    );

    expect(actions).toEqual(["images", "builder"]);
  });
});
