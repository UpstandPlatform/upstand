import { describe, expect, test } from "bun:test";
import {
  parseResourceConfiguration,
  RESOURCE_STATE_VERSION,
  serializeResourceConfiguration,
} from "./index";

describe("versioned resource configuration", () => {
  test("normalizes missing and malformed legacy values to safe defaults", () => {
    const configuration = parseResourceConfiguration({
      buildConfig: "not-json",
      advancedConfig: "not-json",
      watchPaths: "not-json",
      domains: "not-json",
    });

    expect(configuration.version).toBe(RESOURCE_STATE_VERSION);
    expect(configuration.buildConfig.type).toBe("dockerfile");
    expect(configuration.advancedConfig.isolatedDeployment).toBe(false);
    expect(configuration.watchPaths).toEqual([]);
    expect(configuration.domains).toEqual([]);
  });

  test("serializes a validated document into the owned storage fields", () => {
    const domains = parseResourceConfiguration({
      domains: JSON.stringify([{ host: "app.example.com", port: 3000 }]),
    }).domains;
    const stored = serializeResourceConfiguration({
      watchPaths: ["apps/**"],
      domains,
    });

    expect(stored.version).toBe(RESOURCE_STATE_VERSION);
    expect(JSON.parse(stored.watchPaths)).toEqual(["apps/**"]);
    expect(JSON.parse(stored.domains)).toMatchObject([
      { host: "app.example.com", port: 3000 },
    ]);
  });
});
