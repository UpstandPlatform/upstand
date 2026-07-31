import { describe, expect, test } from "bun:test";
import { getUpGalToolNamesForUser } from "./upgal";

describe("UpGal Tool Capability Filtering", () => {
  test("excludes get_web_server_logs for non-instance owners", async () => {
    const tools = await getUpGalToolNamesForUser("user-member-1", "org-1");
    expect(tools.includes("get_web_server_logs")).toBe(false);
  });

  test("excludes local Swarm tools for non-instance owners in Cloud mode", async () => {
    const originalIsCloud = process.env.IS_CLOUD;
    process.env.IS_CLOUD = "true";
    try {
      const tools = await getUpGalToolNamesForUser("user-member-1", "org-1");
      expect(tools.includes("get_swarm_info")).toBe(false);
      expect(tools.includes("get_swarm_nodes")).toBe(false);
      expect(tools.includes("get_swarm_containers")).toBe(false);
    } finally {
      process.env.IS_CLOUD = originalIsCloud;
    }
  });
});
