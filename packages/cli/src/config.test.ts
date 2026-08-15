import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearToken,
  readProjectLink,
  readUserConfig,
  saveToken,
  writeProjectLink,
} from "./config";

describe("CLI configuration", () => {
  test("round-trips credentials and project links without exposing project tokens", async () => {
    const directory = await mkdtemp(join(tmpdir(), "upstand-cli-"));
    process.env.UPSTAND_CONFIG_DIR = join(directory, "config");
    await saveToken("upk_secret", "https://example.test", "org_1");
    expect((await readUserConfig()).organizationId).toBe("org_1");
    await clearToken();
    expect((await readUserConfig()).organizationId).toBeUndefined();
    const projectDirectory = join(directory, "project");
    await writeProjectLink(
      {
        apiUrl: "https://example.test",
        organizationId: "org_1",
        projectId: "project_1",
        environmentId: "env_1",
        createdAt: new Date().toISOString(),
      },
      projectDirectory,
    );

    const link = await readProjectLink(projectDirectory);
    expect(link?.projectId).toBe("project_1");
    expect(
      await readFile(
        join(projectDirectory, ".upstand", "project.json"),
        "utf8",
      ),
    ).not.toContain("upk_secret");
  });
});
