import { describe, expect, test } from "bun:test";
import { ControlContainerInputSchema } from "./control-container.usecase";
import { ControlResourceInputSchema } from "./control-resource.usecase";

describe("Container & Resource Control Workflows", () => {
  test("validates ControlContainerInputSchema for start, stop, restart, kill commands", () => {
    for (const command of ["start", "stop", "restart", "kill"] as const) {
      const parsed = ControlContainerInputSchema.parse({
        resourceId: "res-123",
        containerId: "c-456",
        command,
      });
      expect(parsed.command).toBe(command);
    }
  });

  test("rejects invalid container ID formats", () => {
    expect(() =>
      ControlContainerInputSchema.parse({
        resourceId: "res-123",
        containerId: "",
        command: "stop",
      }),
    ).toThrow();
  });

  test("validates ControlResourceInputSchema", () => {
    for (const command of ["start", "stop", "restart"] as const) {
      const parsed = ControlResourceInputSchema.parse({
        id: "res-123",
        command,
      });
      expect(parsed.command).toBe(command);
    }
  });
});
