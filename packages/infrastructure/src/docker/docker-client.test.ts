import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createBoundedDockerBuildContext,
  isSensitiveDockerBuildContextPath,
} from "./docker-broker-client";
import {
  createDockerClientFromEnvironment,
  createRemoteDocker,
  createRemoteDockerCliEnvironment,
  resolveDockerCliEnvironmentForServer,
  resolveDockerServiceForServer,
  resolveServicesForResource,
} from "./docker-client";

const missingServerUow = {
  serverRepository: { findById: async () => null },
} as never;

async function readTarEntryNames(stream: AsyncIterable<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  const archive = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  const names: string[] = [];
  for (let offset = 0; offset + 512 <= archive.length; ) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header
      .subarray(345, 500)
      .toString("utf8")
      .replace(/\0.*$/, "");
    const sizeText = header
      .subarray(124, 136)
      .toString("ascii")
      .replace(/\0.*$/, "")
      .trim();
    const size = Number.parseInt(sizeText || "0", 8);
    names.push(prefix ? `${prefix}/${name}` : name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

describe("remote Docker client", () => {
  test("keeps sensitive repository files out of typed Docker build contexts", () => {
    const sensitivePaths = [
      ".env",
      ".env.production",
      ".git/config",
      ".ssh/id_ed25519",
      "config/service-account.json",
      "certificates/server.key",
      "nested/credentials.yaml",
    ];
    for (const relativePath of sensitivePaths) {
      expect(isSensitiveDockerBuildContextPath(relativePath)).toBe(true);
    }

    for (const relativePath of [
      "Dockerfile",
      "src/index.ts",
      "public/logo.svg",
      "config/defaults.json",
    ]) {
      expect(isSensitiveDockerBuildContextPath(relativePath)).toBe(false);
    }
  });

  test("does not let .dockerignore re-include sensitive build-context files", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "upstand-build-context-test-"),
    );
    try {
      fs.mkdirSync(path.join(directory, ".git"));
      fs.mkdirSync(path.join(directory, "config"));
      fs.writeFileSync(path.join(directory, "Dockerfile"), "FROM scratch\n");
      fs.writeFileSync(path.join(directory, ".env"), "TOKEN=should-not-ship\n");
      fs.writeFileSync(
        path.join(directory, ".git", "config"),
        "[remote]\nurl=https://token@example.invalid/repo\n",
      );
      fs.writeFileSync(path.join(directory, "config", "defaults.json"), "{}\n");
      fs.writeFileSync(path.join(directory, ".dockerignore"), "!.env\n");

      const names = await readTarEntryNames(
        createBoundedDockerBuildContext(
          directory,
          path.join(directory, "Dockerfile"),
        ),
      );
      expect(names).toContain("Dockerfile");
      expect(names).toContain("config/defaults.json");
      expect(names).not.toContain(".env");
      expect(
        names.some((name) => name === ".git" || name.startsWith(".git/")),
      ).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects a sensitive path selected as the Dockerfile", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "upstand-build-context-test-"),
    );
    try {
      const envPath = path.join(directory, ".env");
      fs.writeFileSync(envPath, "TOKEN=must-not-ship\n");

      expect(() => createBoundedDockerBuildContext(directory, envPath)).toThrow(
        "must not use a credential-bearing or VCS metadata path",
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("honors an explicit Unix-socket Docker transport", () => {
    const docker = createDockerClientFromEnvironment(
      "unix:///run/upstand/docker-broker.sock",
    );
    expect(
      Reflect.get(Reflect.get(docker, "modem") as object, "socketPath"),
    ).toBe("/run/upstand/docker-broker.sock");
  });

  test("honors an explicit constrained TCP Docker transport", () => {
    const docker = createDockerClientFromEnvironment(
      "tcp://docker-broker:2375",
    );
    const modem: unknown = Reflect.get(docker, "modem");
    expect(modem).toMatchObject({ host: "docker-broker", port: 2375 });
  });

  test("adds the broker secret to HTTP Docker requests", () => {
    const previous = process.env.UPSTAND_DOCKER_BROKER_TOKEN;
    process.env.UPSTAND_DOCKER_BROKER_TOKEN = "x".repeat(32);
    try {
      const docker = createDockerClientFromEnvironment(
        "http://docker-broker:2375",
      );
      const modem: unknown = Reflect.get(docker, "modem");
      expect(modem).toMatchObject({
        headers: { "X-Upstand-Docker-Broker-Token": "x".repeat(32) },
      });
    } finally {
      if (previous === undefined)
        delete process.env.UPSTAND_DOCKER_BROKER_TOKEN;
      else process.env.UPSTAND_DOCKER_BROKER_TOKEN = previous;
    }
  });

  test("supports per-resource Docker request headers", () => {
    const docker = createDockerClientFromEnvironment(
      "http://docker-broker:2375",
      { "X-Upstand-Resource-ID": "resource-1" },
    );
    const modem: unknown = Reflect.get(docker, "modem");
    expect(modem).toMatchObject({
      headers: { "X-Upstand-Resource-ID": "resource-1" },
    });
  });

  test("attaches the active signed deployment scope to Docker requests", () => {
    const previous = process.env.UPSTAND_DEPLOYMENT_SCOPE_TOKEN;
    process.env.UPSTAND_DEPLOYMENT_SCOPE_TOKEN = "v1.scope.signature";
    try {
      const docker = createDockerClientFromEnvironment(
        "http://docker-broker:2375",
      );
      const modem: unknown = Reflect.get(docker, "modem");
      expect(modem).toMatchObject({
        headers: { "X-Upstand-Docker-Scope": "v1.scope.signature" },
      });
    } finally {
      if (previous === undefined)
        delete process.env.UPSTAND_DEPLOYMENT_SCOPE_TOKEN;
      else process.env.UPSTAND_DEPLOYMENT_SCOPE_TOKEN = previous;
    }
  });

  test("supports HTTPS Docker broker transport with client certificates", () => {
    const previous = {
      ca: process.env.UPSTAND_DOCKER_BROKER_CA_FILE,
      cert: process.env.UPSTAND_DOCKER_BROKER_CLIENT_CERT_FILE,
      key: process.env.UPSTAND_DOCKER_BROKER_CLIENT_KEY_FILE,
    };
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "upstand-docker-client-test-"),
    );
    const files = {
      ca: path.join(directory, "ca.pem"),
      cert: path.join(directory, "client.pem"),
      key: path.join(directory, "client-key.pem"),
    };
    fs.writeFileSync(files.ca, "ca");
    fs.writeFileSync(files.cert, "cert");
    fs.writeFileSync(files.key, "key");
    process.env.UPSTAND_DOCKER_BROKER_CA_FILE = files.ca;
    process.env.UPSTAND_DOCKER_BROKER_CLIENT_CERT_FILE = files.cert;
    process.env.UPSTAND_DOCKER_BROKER_CLIENT_KEY_FILE = files.key;
    try {
      const docker = createDockerClientFromEnvironment(
        "https://docker-broker:2375",
      );
      const modem: unknown = Reflect.get(docker, "modem");
      expect(modem).toMatchObject({
        host: "docker-broker",
        port: 2375,
        protocol: "https",
        ca: Buffer.from("ca"),
        cert: Buffer.from("cert"),
        key: Buffer.from("key"),
      });
    } finally {
      for (const [variable, value] of Object.entries({
        UPSTAND_DOCKER_BROKER_CA_FILE: previous.ca,
        UPSTAND_DOCKER_BROKER_CLIENT_CERT_FILE: previous.cert,
        UPSTAND_DOCKER_BROKER_CLIENT_KEY_FILE: previous.key,
      })) {
        if (value === undefined) delete process.env[variable];
        else process.env[variable] = value;
      }
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects unsupported Docker transports", () => {
    expect(() =>
      createDockerClientFromEnvironment("ssh://docker-host"),
    ).toThrow("DOCKER_HOST must use");
  });

  test("uses a local Unix socket instead of Dockerode's SSH URL transport", () => {
    const docker = createRemoteDocker({
      host: "ssh://203.0.113.10",
      port: 22,
      username: "root",
      privateKey: "test-key",
      hostKeyFingerprint: "SHA256:YWJjZA==",
    });

    if (process.platform === "win32") {
      const modem: unknown = Reflect.get(docker, "modem");
      expect(modem).toMatchObject({ host: "127.0.0.1" });
      expect(Reflect.get(modem as object, "port")).toBeDefined();
    } else {
      const modem: unknown = Reflect.get(docker, "modem");
      expect(Reflect.get(modem as object, "host")).toBeUndefined();
      expect(Reflect.get(modem as object, "socketPath")).toContain(
        "upstand-docker-",
      );
    }
  });

  test("uses the verified local tunnel for Docker CLI commands", () => {
    const cli = createRemoteDockerCliEnvironment({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      privateKey: "test-key",
      hostKeyFingerprint: "SHA256:YWJjZA==",
    });

    expect(cli.environment.DOCKER_HOST).toMatch(
      process.platform === "win32" ? /^tcp:\/\/127\.0\.0\.1:/ : /^unix:\/\//,
    );
    expect(cli.environment.DOCKER_HOST).not.toContain("ssh://");
    cli.cleanup();
  });

  test("fails closed when a referenced server is missing", async () => {
    await expect(
      resolveDockerCliEnvironmentForServer("stale-server", missingServerUow),
    ).rejects.toThrow("Target deployment server was not found");
    await expect(
      resolveDockerServiceForServer(
        "stale-server",
        missingServerUow,
        {} as never,
      ),
    ).rejects.toThrow("Target deployment server was not found");
    await expect(
      resolveServicesForResource(
        { serverId: "stale-server" } as never,
        missingServerUow,
        {} as never,
        {} as never,
      ),
    ).rejects.toThrow("Resource target server was not found");
  });
});
