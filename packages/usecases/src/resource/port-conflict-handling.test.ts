import { describe, expect, test } from "bun:test";
import {
  parseResourceAdvancedConfig,
  ResourcePortSchema,
  serializeResourceAdvancedConfig,
} from "@upstand/domain";

describe("Port Conflict & Advanced Config Schema Validation", () => {
  test("validates ResourcePortSchema with tcp and udp protocols", () => {
    const tcpPort = ResourcePortSchema.parse({
      publishedPort: 8080,
      targetPort: 80,
      protocol: "tcp",
    });
    expect(tcpPort.publishedPort).toBe(8080);
    expect(tcpPort.targetPort).toBe(80);
    expect(tcpPort.protocol).toBe("tcp");

    const udpPort = ResourcePortSchema.parse({
      publishedPort: 5353,
      targetPort: 53,
      protocol: "udp",
    });
    expect(udpPort.protocol).toBe("udp");
  });

  test("rejects invalid port numbers (< 1 or > 65535)", () => {
    expect(() =>
      ResourcePortSchema.parse({ publishedPort: 0, targetPort: 80 }),
    ).toThrow();
    expect(() =>
      ResourcePortSchema.parse({ publishedPort: 80, targetPort: 70000 }),
    ).toThrow();
  });

  test("serializes and parses advanced config with port mappings cleanly", () => {
    const config = parseResourceAdvancedConfig(null);
    config.ports = [
      { publishedPort: 3000, targetPort: 3000, protocol: "tcp" },
      { publishedPort: 8443, targetPort: 443, protocol: "tcp" },
    ];

    const serialized = serializeResourceAdvancedConfig(config);
    const reParsed = parseResourceAdvancedConfig(serialized);

    expect(reParsed.ports).toHaveLength(2);
    expect(reParsed.ports[0]?.publishedPort).toBe(3000);
    expect(reParsed.ports[1]?.publishedPort).toBe(8443);
  });
});
