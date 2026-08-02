import { describe, expect, test } from "bun:test";
import {
  buildExternalPostgresDockerArgs,
  buildSafeArchiveRestoreCommand,
  shellQuote,
  validateControlPlanePostgresUrl,
  validateFileDatabaseRestore,
  validatePostgresPitrBackupName,
  validatePostgresPitrDataPath,
  validatePostgresPitrManifest,
  validateWebServerBackupManifest,
} from "./backup-runtime.service";

const manifestKey = "web-server/platform/2026-07-14/manifest.json";

describe("safe archive restores", () => {
  test("stages extraction and keeps a rollback copy until replacement succeeds", () => {
    const command = buildSafeArchiveRestoreCommand("/target");
    expect(command).toContain("mktemp -d");
    expect(command).toContain("stage");
    expect(command).toContain("previous");
    expect(command).toContain("restore_previous");
    expect(command).toContain('2>"$warnings"');
    expect(command).toContain('tar -tzf "$archive"');
    expect(command).toContain("^[lhbcps]");
    expect(command).toContain("--no-same-permissions");
  });

  test("rejects shell syntax and traversal in archive targets", () => {
    expect(() =>
      buildSafeArchiveRestoreCommand("/target;touch /tmp/pwned"),
    ).toThrow("Archive restore target is invalid");
    expect(() => buildSafeArchiveRestoreCommand("/target/../etc")).toThrow(
      "Archive restore target is invalid",
    );
  });

  test("requires file-backed database restores to stop the service", () => {
    expect(() => validateFileDatabaseRestore("redis", false)).toThrow(
      "stopService",
    );
    expect(() => validateFileDatabaseRestore("libsql", false)).toThrow(
      "stopService",
    );
    expect(validateFileDatabaseRestore("redis", true)).toBeUndefined();
  });
});

describe("web-server backup manifests", () => {
  test("accepts only the control-plane dump and Caddy volume artifacts", () => {
    expect(
      validateWebServerBackupManifest(
        {
          version: 1,
          createdAt: "2026-07-14T00:00:00.000Z",
          files: [
            "web-server/platform/2026-07-14/control-plane.dump",
            "web-server/platform/2026-07-14/upstand-caddy-runtime.tar.gz",
            "web-server/platform/2026-07-14/upstand-caddy-data.tar.gz",
            "web-server/platform/2026-07-14/upstand-caddy-config.tar.gz",
          ],
        },
        manifestKey,
      ).files,
    ).toHaveLength(4);
  });

  test("rejects traversal and unexpected artifacts", () => {
    expect(() =>
      validateWebServerBackupManifest(
        {
          version: 1,
          files: ["web-server/platform/2026-07-14/../../secrets.tar.gz"],
        },
        manifestKey,
      ),
    ).toThrow("manifest is invalid");
  });
});

describe("external control-plane PostgreSQL execution", () => {
  test("validates a PostgreSQL URL without exposing it in Docker arguments", () => {
    const url = "postgresql://user:secret@example.test:5432/upstand";
    expect(validateControlPlanePostgresUrl(url)).toBe(url);

    const args = buildExternalPostgresDockerArgs(
      "/tmp/database.env",
      "upstand-network",
      'pg_dump --dbname "$DATABASE_URL"',
    );
    expect(args).toContain("--env-file");
    expect(args).toContain(
      "postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15",
    );
    expect(args).not.toContain(url);
  });

  test("rejects non-PostgreSQL and multiline connection values", () => {
    expect(() =>
      validateControlPlanePostgresUrl("redis://example.test"),
    ).toThrow("connection is invalid");
    expect(() =>
      validateControlPlanePostgresUrl("postgresql://example.test\nBAD"),
    ).toThrow("connection is not configured");
  });
});

describe("PostgreSQL PITR input validation", () => {
  test("accepts WAL-G backup names and rejects shell metacharacters", () => {
    expect(
      validatePostgresPitrBackupName("base_00000001000000000000000A"),
    ).toBe("base_00000001000000000000000A");
    expect(() =>
      validatePostgresPitrBackupName("base; touch /tmp/pwned"),
    ).toThrow("backup name is invalid");
    expect(() => validatePostgresPitrBackupName("../backup")).toThrow(
      "backup name is invalid",
    );
  });

  test("accepts absolute data paths and rejects traversal or shell syntax", () => {
    expect(validatePostgresPitrDataPath("/var/lib/postgresql/18/docker")).toBe(
      "/var/lib/postgresql/18/docker",
    );
    expect(() => validatePostgresPitrDataPath("/var/lib/../secrets")).toThrow(
      "data path is invalid",
    );
    expect(() =>
      validatePostgresPitrDataPath("/var/lib/postgres;touch x"),
    ).toThrow("data path is invalid");
  });

  test("quotes shell values as single-quoted literals", () => {
    expect(shellQuote("backup'name")).toBe(`'backup'\\''name'`);
    expect(shellQuote("$(touch /tmp/pwned)")).toBe("'$(touch /tmp/pwned)'");
  });

  test("validates the PITR manifest shape and backup name", () => {
    expect(
      validatePostgresPitrManifest({
        version: 1,
        kind: "postgres-pitr",
        createdAt: "2026-07-14T00:00:00.000Z",
        backupName: "base_00000001000000000000000A",
      }).backupName,
    ).toBe("base_00000001000000000000000A");
    expect(() =>
      validatePostgresPitrManifest({
        version: 1,
        kind: "postgres-pitr",
        createdAt: "2026-07-14T00:00:00.000Z",
        backupName: "$(touch /tmp/pwned)",
      }),
    ).toThrow("backup name is invalid");
  });
});
