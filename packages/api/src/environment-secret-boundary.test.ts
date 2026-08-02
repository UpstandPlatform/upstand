import { describe, expect, test } from "bun:test";
import type { Environment } from "@upstand/domain";
import { publicEnvironment } from "./routers/environment.router";

const environment: Environment = {
  id: "environment-1",
  projectId: "project-1",
  parentEnvironmentId: null,
  inheritsVariables: false,
  name: "Production",
  slug: "production",
  description: null,
  isDefault: true,
  isProtected: true,
  resourceCount: 2,
  envVars: "encrypted-secret-payload",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("environment secret response boundary", () => {
  test("redacts encrypted environment variables from ordinary responses", () => {
    const response = publicEnvironment(environment);

    expect(response.envVars).toEqual({});
    expect(response.envVarsConfigured).toBe(true);
    expect(JSON.stringify(response)).not.toContain("encrypted-secret-payload");
  });

  test("preserves the configured-state flag on metadata projections", () => {
    const response = publicEnvironment({
      ...environment,
      envVars: undefined,
      envVarsConfigured: true,
    });

    expect(response.envVars).toEqual({});
    expect(response.envVarsConfigured).toBe(true);
  });
});
