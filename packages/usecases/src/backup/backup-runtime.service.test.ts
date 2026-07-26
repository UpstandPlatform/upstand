import { describe, expect, test } from "bun:test";
import { validateWebServerBackupManifest } from "./backup-runtime.service";

const manifestKey = "web-server/platform/2026-07-14/manifest.json";

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
