import { describe, expect, test } from "bun:test";
import {
  compareDesktopVersions,
  getDesktopUpdateInfo,
  parseDesktopRelease,
  planDesktopUpdate,
} from "../src/main/desktop-updates";

const digest = `sha256:${"a".repeat(64)}`;
const tag = "v1.2.3";
const version = "1.2.3";

function releaseAsset(name: string) {
  return {
    name,
    size: 1024,
    digest,
    browser_download_url: `https://github.com/UpstandPlatform/upstand/releases/download/${tag}/${name}`,
  };
}

function release(assets: string[] = []) {
  return parseDesktopRelease({
    tag_name: tag,
    html_url: `https://github.com/UpstandPlatform/upstand/releases/tag/${tag}`,
    draft: false,
    prerelease: false,
    assets: assets.map(releaseAsset),
  });
}

describe("desktop update planning", () => {
  test("compares only stable semantic versions", () => {
    expect(compareDesktopVersions("v1.10.0", "1.9.9")).toBe(1);
    expect(compareDesktopVersions("1.2.3", "v1.2.3")).toBe(0);
    expect(compareDesktopVersions("1.2.3-beta.1", "1.2.3")).toBe(0);
    expect(compareDesktopVersions("not-a-version", "1.2.3")).toBe(0);
  });

  test("plans Windows updates from the Squirrel feed and package assets", () => {
    const windowsRelease = release([
      "RELEASES",
      `upstand-${version}-full.nupkg`,
    ]);
    const windowsPlan = planDesktopUpdate(windowsRelease, {
      platform: "win32",
      architecture: "x64",
    });
    expect(windowsPlan?.format).toBe("squirrel");
    expect(windowsPlan?.assets.map((asset) => asset.name)).toEqual([
      "RELEASES",
      `upstand-${version}-full.nupkg`,
    ]);
    expect(
      planDesktopUpdate(release([`upstand-${version}-full.nupkg`]), {
        platform: "win32",
        architecture: "x64",
      }),
    ).toBeNull();
  });

  test("selects matching macOS and Linux installation formats", () => {
    const desktopRelease = release([
      `upstand-darwin-arm64-${version}.zip`,
      `desktop_${version}_amd64.deb`,
      `upstand-linux-x64-${version}.zip`,
    ]);
    expect(
      planDesktopUpdate(desktopRelease, {
        platform: "darwin",
        architecture: "arm64",
      })?.format,
    ).toBe("mac-zip");
    expect(
      planDesktopUpdate(desktopRelease, {
        platform: "linux",
        architecture: "x64",
        linuxInstallKind: "deb",
      })?.format,
    ).toBe("linux-deb");
    expect(
      planDesktopUpdate(desktopRelease, {
        platform: "linux",
        architecture: "x64",
        linuxInstallKind: "portable",
      })?.format,
    ).toBe("linux-zip");
    expect(
      planDesktopUpdate(desktopRelease, {
        platform: "linux",
        architecture: "arm64",
        linuxInstallKind: "portable",
      }),
    ).toBeNull();
  });

  test("rejects prereleases and ignores untrusted or unverifiable assets", () => {
    expect(() =>
      parseDesktopRelease({ tag_name: tag, prerelease: true, assets: [] }),
    ).toThrow("stable Upstand desktop release");

    const trusted = releaseAsset(`upstand-darwin-arm64-${version}.zip`);
    const untrusted = {
      ...trusted,
      browser_download_url: "https://downloads.example.invalid/update.zip",
    };
    const noDigest = { ...trusted, digest: null };
    const parsed = parseDesktopRelease({
      tag_name: tag,
      assets: [untrusted, noDigest],
    });
    expect(parsed.assets).toEqual([]);
    expect(
      planDesktopUpdate(parsed, { platform: "darwin", architecture: "arm64" }),
    ).toBeNull();
  });

  test("explains when an update exists but cannot be installed by this build", () => {
    const desktopRelease = release([`upstand-darwin-arm64-${version}.zip`]);
    const result = getDesktopUpdateInfo({
      currentVersion: "1.0.0",
      release: desktopRelease,
      target: { platform: "darwin", architecture: "x64" },
      isPackaged: true,
    });
    expect(result.info).toMatchObject({
      updateAvailable: true,
      canUpdate: false,
      unavailableReason:
        "An installer for this operating system and architecture is not available yet.",
    });
  });
});
