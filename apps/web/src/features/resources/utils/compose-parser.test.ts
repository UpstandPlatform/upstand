// @ts-nocheck
import { describe, expect, test } from "bun:test";
import {
  extractPortsAndVolumesFromServices,
  parsePortString,
  parseVolumeString,
} from "./compose-parser";

describe("compose resource inspection parsing", () => {
  test("parses supported port forms and protocols", () => {
    expect(parsePortString("8080:80")).toEqual({
      publishedPort: 8080,
      targetPort: 80,
      protocol: "tcp",
    });
    expect(parsePortString("127.0.0.1:5353:53/udp")).toEqual({
      publishedPort: 5353,
      targetPort: 53,
      protocol: "udp",
    });
    expect(parsePortString("443")).toEqual({
      publishedPort: 443,
      targetPort: 443,
      protocol: "tcp",
    });
  });

  test("rejects empty and out-of-range ports", () => {
    expect(parsePortString("")).toBeNull();
    expect(parsePortString("0:80")).toBeNull();
    expect(parsePortString("65536:80")).toBeNull();
    expect(parsePortString("8080:65536")).toBeNull();
  });

  test("parses named, bind, and anonymous volumes", () => {
    expect(parseVolumeString("db_data:/var/lib/mysql:ro")).toEqual({
      source: "db_data",
      target: "/var/lib/mysql",
      readOnly: true,
    });
    expect(parseVolumeString("/host/dir:/container/dir:rw")).toEqual({
      source: "/host/dir",
      target: "/container/dir",
      readOnly: false,
    });
    expect(parseVolumeString("/var/lib/data")).toEqual({
      source: "data-data",
      target: "/var/lib/data",
      readOnly: false,
    });
  });

  test("deduplicates valid ports and volumes across services", () => {
    expect(
      extractPortsAndVolumesFromServices([
        { ports: ["8080:80", "8080:80", "invalid"] },
        {
          ports: ["8080:80/udp"],
          volumes: ["db:/data", "db:/data", "/host:/data:ro"],
        },
      ]),
    ).toEqual({
      ports: [
        { publishedPort: 8080, targetPort: 80, protocol: "tcp" },
        { publishedPort: 8080, targetPort: 80, protocol: "udp" },
      ],
      volumes: [
        { source: "db", target: "/data", readOnly: false },
        { source: "/host", target: "/data", readOnly: true },
      ],
    });
  });
});
