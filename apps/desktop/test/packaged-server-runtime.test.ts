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

describe("packaged Desktop server runtime", () => {
  test("compiles a standalone local API instead of using Electron's Node ESM loader", () => {
    expect(desktopBuild).toContain('"--compile"');
    expect(desktopBuild).toContain('"--packages=bundle"');
    expect(services).toContain('"upstand-local-server.exe"');
    expect(services).toContain("useElectronNode ? process.execPath : entry");
    expect(services).toContain("false,");
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
    expect(forgeConfig).toContain('assets", "icon"');
    expect(forgeConfig).toContain(
      "raw.githubusercontent.com/UpstandPlatform/upstand",
    );
    expect(mainProcess).toContain('from "electron-squirrel-startup"');
    expect(mainProcess).toContain("if (squirrelStartup)");
    expect(mainProcess).toContain('app.setPath("userData"');
    expect(forgeConfig).toContain("preMake");
    expect(forgeConfig).toContain('"squirrel.windows"');
  });
});
