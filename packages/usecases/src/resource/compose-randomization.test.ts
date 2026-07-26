import { describe, expect, test } from "bun:test";
import { randomizeComposeFile } from "./compose-randomization";

describe("Compose randomization", () => {
  test("renames services and named resources without breaking references", () => {
    const result = randomizeComposeFile(
      [
        "services:",
        "  api:",
        "    depends_on: [db]",
        "    networks: [appnet]",
        "    volumes: [data:/var/lib/data]",
        "  db:",
        "    networks:",
        "      appnet: {}",
        "volumes:",
        "  data: {}",
        "networks:",
        "  appnet: {}",
      ].join("\n"),
      "safe1",
    );

    expect(result).toContain("api-safe1:");
    expect(result).toContain("db-safe1");
    expect(result).toContain("data-safe1:/var/lib/data");
    expect(result).toContain("appnet-safe1");
  });
});
