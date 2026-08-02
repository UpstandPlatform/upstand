import { describe, expect, test } from "bun:test";
import {
  createGitBasicAuthEnvironment,
  removeGitUrlCredentials,
} from "./git-source-auth";

describe("Git source authentication", () => {
  test("keeps basic credentials out of the clone URL", () => {
    const result = removeGitUrlCredentials(
      "https://deploy-user:deploy-password@example.com/acme/app.git",
    );

    expect(result.cloneUrl).toBe("https://example.com/acme/app.git");
    expect(result.cloneUrl).not.toContain("deploy-password");
    expect(result.gitEnvironment?.GIT_CONFIG_KEY_0).toBe("http.extraHeader");
    expect(result.gitEnvironment?.GIT_CONFIG_VALUE_0).toContain(
      Buffer.from("deploy-user:deploy-password").toString("base64"),
    );
  });

  test("rejects incomplete generated credentials", () => {
    expect(() => createGitBasicAuthEnvironment("deploy-user", "")).toThrow(
      "credentials are incomplete",
    );
  });
});
