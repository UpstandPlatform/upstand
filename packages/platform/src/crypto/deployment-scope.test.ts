import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDeploymentScopeToken,
  readDeploymentScopeHeaders,
  readDeploymentScopeToken,
  withDeploymentScopeToken,
} from "./deployment-scope";

const secret = randomBytes(32).toString("hex");

function withScopeEnvironment<T>(
  values: {
    file?: string;
    value?: string;
    fallbackToken?: string;
  },
  operation: () => T,
): T {
  const previous = {
    file: process.env.UPSTAND_DOCKER_BROKER_SCOPE_SECRET_FILE,
    value: process.env.UPSTAND_DOCKER_BROKER_SCOPE_SECRET,
    fallbackToken: process.env.UPSTAND_DEPLOYMENT_SCOPE_TOKEN,
  };
  try {
    if (values.file === undefined) {
      delete process.env.UPSTAND_DOCKER_BROKER_SCOPE_SECRET_FILE;
    } else {
      process.env.UPSTAND_DOCKER_BROKER_SCOPE_SECRET_FILE = values.file;
    }
    if (values.value === undefined) {
      delete process.env.UPSTAND_DOCKER_BROKER_SCOPE_SECRET;
    } else {
      process.env.UPSTAND_DOCKER_BROKER_SCOPE_SECRET = values.value;
    }
    if (values.fallbackToken === undefined) {
      delete process.env.UPSTAND_DEPLOYMENT_SCOPE_TOKEN;
    } else {
      process.env.UPSTAND_DEPLOYMENT_SCOPE_TOKEN = values.fallbackToken;
    }
    return operation();
  } finally {
    if (previous.file === undefined) {
      delete process.env.UPSTAND_DOCKER_BROKER_SCOPE_SECRET_FILE;
    } else {
      process.env.UPSTAND_DOCKER_BROKER_SCOPE_SECRET_FILE = previous.file;
    }
    if (previous.value === undefined) {
      delete process.env.UPSTAND_DOCKER_BROKER_SCOPE_SECRET;
    } else {
      process.env.UPSTAND_DOCKER_BROKER_SCOPE_SECRET = previous.value;
    }
    if (previous.fallbackToken === undefined) {
      delete process.env.UPSTAND_DEPLOYMENT_SCOPE_TOKEN;
    } else {
      process.env.UPSTAND_DEPLOYMENT_SCOPE_TOKEN = previous.fallbackToken;
    }
  }
}

describe("deployment scope grants", () => {
  test("creates a signed grant from the secret file", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "upstand-scope-"));
    const secretFile = path.join(directory, "scope-secret");
    writeFileSync(secretFile, `${secret}\n`, { mode: 0o600 });
    try {
      const token = withScopeEnvironment({ file: secretFile }, () =>
        createDeploymentScopeToken({
          resourceId: "resource-1",
          deploymentId: "deployment-1",
          serverId: "server-1",
          now: 1_700_000_000_000,
        }),
      );
      expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(token?.split(".")[1]).toBeTruthy();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects an undersized signing secret", () => {
    expect(() =>
      withScopeEnvironment({ value: "too-short" }, () =>
        createDeploymentScopeToken({
          resourceId: "resource-1",
          deploymentId: "deployment-1",
          serverId: "server-1",
        }),
      ),
    ).toThrow("at least 32 bytes");
  });

  test("keeps concurrent deployment grants isolated", async () => {
    await withDeploymentScopeToken("grant-a", async () => {
      const first = withDeploymentScopeToken("grant-a", async () => {
        await Promise.resolve();
        return readDeploymentScopeToken();
      });
      const second = withDeploymentScopeToken("grant-b", async () => {
        await Promise.resolve();
        return readDeploymentScopeToken();
      });
      expect(await Promise.all([first, second])).toEqual([
        "grant-a",
        "grant-b",
      ]);
    });
  });

  test("does not fall back to a process token inside an explicit empty scope", async () => {
    await withScopeEnvironment(
      { fallbackToken: "stale-process-token" },
      async () => {
        await withDeploymentScopeToken(undefined, async () => {
          expect(readDeploymentScopeToken()).toBeUndefined();
        });
      },
    );
  });

  test("mirrors signed routing claims into broker headers", () => {
    const token = withScopeEnvironment({ file: undefined, value: secret }, () =>
      createDeploymentScopeToken({
        resourceId: "resource-1",
        deploymentId: "deployment-1",
        serverId: "server-1",
      }),
    );
    if (!token) throw new Error("expected a signed deployment scope token");
    expect(
      withScopeEnvironment({ fallbackToken: token }, () =>
        readDeploymentScopeHeaders(),
      ),
    ).toEqual({
      "X-Upstand-Docker-Scope": token,
      "X-Upstand-Deployment-ID": "deployment-1",
      "X-Upstand-Server-ID": "server-1",
    });
  });
});
