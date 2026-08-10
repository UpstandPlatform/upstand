import { describe, expect, test } from "bun:test";
import type { WorkloadRuntimePort } from "./runtime";
import {
  RuntimeAdapterRegistry,
  RuntimeAdapterUnavailableError,
} from "./runtime";

const docker = {
  runtime: "docker",
  deploy: async () => {
    throw new Error("unused");
  },
  health: async () => ({ healthy: true, state: "ready", message: null }),
  logs: async () => "",
  rollback: async () => {},
  remove: async () => {},
} satisfies WorkloadRuntimePort;

describe("RuntimeAdapterRegistry", () => {
  test("resolves only adapters registered at composition time", () => {
    const registry = new RuntimeAdapterRegistry([docker]);
    expect(registry.supports("docker")).toBe(true);
    expect(registry.supports("bare-process")).toBe(false);
    expect(registry.resolve("docker")).toBe(docker);
    expect(() => registry.resolve("cloud")).toThrow(
      RuntimeAdapterUnavailableError,
    );
  });

  test("rejects duplicate runtime ownership", () => {
    expect(() => new RuntimeAdapterRegistry([docker, docker])).toThrow(
      "Duplicate runtime adapter 'docker'",
    );
  });
});
