import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const services = readFileSync(
  new URL("../src/main/services.ts", import.meta.url),
  "utf8",
);
const desktopManifest = readFileSync(
  new URL("../package.json", import.meta.url),
  "utf8",
);
const forgeConfig = readFileSync(
  new URL("../forge.config.cjs", import.meta.url),
  "utf8",
);
const mainProcess = readFileSync(
  new URL("../src/main/index.ts", import.meta.url),
  "utf8",
);
const desktopBuild = readFileSync(
  new URL("../build/build.ts", import.meta.url),
  "utf8",
);
const packagedRuntimeVerifier = readFileSync(
  new URL("../scripts/verify-packaged-server-runtime.ts", import.meta.url),
  "utf8",
);
const dockerBrokerClient = readFileSync(
  new URL(
    "../../../packages/infrastructure/src/docker/docker-broker-client.ts",
    import.meta.url,
  ),
  "utf8",
);

describe("packaged Desktop server runtime", () => {
  test("compiles a standalone local API instead of using Electron's Node ESM loader", () => {
    expect(desktopBuild).toContain('"--compile"');
    expect(desktopBuild).toContain('"--packages=bundle"');
    expect(services).toContain('"upstand-local-server.exe"');
    expect(services).toContain("useElectronNode ? process.execPath : entry");
    expect(services).toContain("false,");
  });

  test("provides every required disposable secret to the packaged runtime verifier", () => {
    expect(packagedRuntimeVerifier).toContain(
      'BETTER_AUTH_SECRET: "desktop-runtime-test-secret-at-least-32-characters"',
    );
    expect(packagedRuntimeVerifier).toContain(
      '"desktop-runtime-test-approval-secret-at-least-32-characters"',
    );
    expect(packagedRuntimeVerifier).toContain("ENCRYPTION_KEY_V1:");
  });

  test("allows slow packaged services a bounded startup window", () => {
    expect(packagedRuntimeVerifier).toContain("startupTimeoutMs = 60_000");
    expect(services).toContain("serviceStartupTimeoutMs = 60_000");
  });

  test("statically imports Docker context packaging dependencies", () => {
    expect(dockerBrokerClient).toContain('from "tar-fs"');
    expect(dockerBrokerClient).not.toContain('from "node:module"');
    expect(dockerBrokerClient).not.toContain('require("tar-fs")');
  });

  test("uses Upstand Windows application metadata and icon assets", () => {
    expect(forgeConfig).toContain('appBundleId: "dev.upstand.desktop"');
    expect(forgeConfig).toContain(
      'setupIcon: resolve(__dirname, "assets", "icon.ico")',
    );
    expect(mainProcess).toContain(
      'app.setAppUserModelId("dev.upstand.desktop")',
    );
  });

  test("uses Next's nested standalone dashboard entrypoint", () => {
    expect(services).toContain('"dashboard", "apps", "web", "server.js"');
    expect(desktopBuild).toContain('resolve(localRoot, "dashboard")');
    expect(desktopBuild).toContain(
      'resolve(localRoot, "dashboard", "apps", "web", ".next", "static")',
    );
    expect(desktopBuild).toContain(
      'resolve(localRoot, "dashboard", "apps", "web", "public")',
    );
    expect(desktopBuild).toContain("dashboardNodeModules");
    expect(desktopBuild).toContain("stagedDashboardModules");
  });

  test("declares Upstand as the installed product and handles Squirrel lifecycle commands", () => {
    expect(desktopManifest).toContain('"productName": "Upstand"');
    expect(forgeConfig).toContain('assets", "icon.ico"');
    expect(forgeConfig).toContain("setupIcon");
    expect(forgeConfig).toContain(
      "raw.githubusercontent.com/UpstandPlatform/upstand",
    );
    expect(mainProcess).toContain('from "electron-squirrel-startup"');
    expect(mainProcess).toContain("if (squirrelStartup)");
    expect(mainProcess).toContain('app.setPath("userData"');
    expect(mainProcess).toContain('assets", "icon.png"');
    expect(forgeConfig).toContain("preMake");
    expect(forgeConfig).toContain('"squirrel.windows"');
  });
});
