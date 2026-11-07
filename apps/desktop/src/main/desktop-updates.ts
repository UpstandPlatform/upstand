const GITHUB_REPOSITORY = "UpstandPlatform/upstand";
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPOSITORY}/releases`;

export type DesktopUpdateAsset = {
  name: string;
  size: number;
  sha256: string;
  downloadUrl: string;
};

export type DesktopRelease = {
  tagName: string;
  version: string;
  releaseUrl: string;
  assets: DesktopUpdateAsset[];
};

export type DesktopUpdateTarget = {
  platform: NodeJS.Platform;
  architecture: string;
  linuxInstallKind?: "deb" | "portable";
};

export type DesktopUpdateFormat =
  | "squirrel"
  | "mac-zip"
  | "linux-deb"
  | "linux-zip";

export type DesktopUpdatePlan = {
  format: DesktopUpdateFormat;
  assets: DesktopUpdateAsset[];
};

export type DesktopUpdateProgress = {
  phase: "downloading" | "installing";
  downloadedBytes: number | null;
  totalBytes: number | null;
  percent: number | null;
};

export type DesktopUpdateInfo = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  canUpdate: boolean;
  releaseUrl: string | null;
  unavailableReason: string | null;
};

type GitHubReleaseAsset = {
  name?: unknown;
  size?: unknown;
  digest?: unknown;
  browser_download_url?: unknown;
};

type GitHubRelease = {
  tag_name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
};

const stableVersionPattern = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const sha256Pattern = /^sha256:([a-f0-9]{64})$/i;
const assetNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;
const maxAssetBytes = 4 * 1024 * 1024 * 1024;

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function parseStableVersion(value: string): [number, number, number] | null {
  const match = stableVersionPattern.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareDesktopVersions(left: string, right: string): number {
  const leftParts = parseStableVersion(left);
  const rightParts = parseStableVersion(right);
  if (!leftParts || !rightParts) return 0;

  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function trustedAssetUrl(
  value: string,
  tagName: string,
  assetName: string,
): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname ===
        `/${GITHUB_REPOSITORY}/releases/download/${tagName}/${assetName}`
    );
  } catch {
    return false;
  }
}

export function parseDesktopRelease(value: unknown): DesktopRelease {
  const release = recordOf(value) as GitHubRelease | null;
  if (
    !release ||
    typeof release.tag_name !== "string" ||
    !parseStableVersion(release.tag_name) ||
    release.draft === true ||
    release.prerelease === true ||
    !Array.isArray(release.assets)
  ) {
    throw new Error("GitHub did not return a stable Upstand desktop release");
  }

  const tagName = release.tag_name;
  const version = tagName.startsWith("v") ? tagName.slice(1) : tagName;
  const releaseUrl = `${GITHUB_RELEASES_URL}/tag/${tagName}`;
  const assets: DesktopUpdateAsset[] = [];

  for (const value of release.assets) {
    const candidate = recordOf(value) as GitHubReleaseAsset | null;
    if (
      !candidate ||
      typeof candidate.name !== "string" ||
      !assetNamePattern.test(candidate.name) ||
      !Number.isSafeInteger(candidate.size) ||
      (candidate.size as number) <= 0 ||
      (candidate.size as number) > maxAssetBytes ||
      typeof candidate.digest !== "string" ||
      typeof candidate.browser_download_url !== "string"
    ) {
      continue;
    }

    const digest = sha256Pattern.exec(candidate.digest)?.[1]?.toLowerCase();
    if (
      !digest ||
      !trustedAssetUrl(candidate.browser_download_url, tagName, candidate.name)
    ) {
      continue;
    }

    assets.push({
      name: candidate.name,
      size: candidate.size as number,
      sha256: digest,
      downloadUrl: candidate.browser_download_url,
    });
  }

  return { tagName, version, releaseUrl, assets };
}

function assetNamed(
  release: DesktopRelease,
  name: string,
): DesktopUpdateAsset | undefined {
  return release.assets.find((asset) => asset.name === name);
}

export function planDesktopUpdate(
  release: DesktopRelease,
  target: DesktopUpdateTarget,
): DesktopUpdatePlan | null {
  const version = release.version;
  if (target.platform === "win32" && target.architecture === "x64") {
    const releases = assetNamed(release, "RELEASES");
    const packageAsset = assetNamed(release, `upstand-${version}-full.nupkg`);
    return releases && packageAsset
      ? { format: "squirrel", assets: [releases, packageAsset] }
      : null;
  }

  if (target.platform === "darwin" && target.architecture === "arm64") {
    const asset = assetNamed(release, `upstand-darwin-arm64-${version}.zip`);
    return asset ? { format: "mac-zip", assets: [asset] } : null;
  }

  if (target.platform === "linux" && target.architecture === "x64") {
    const name =
      target.linuxInstallKind === "deb"
        ? `desktop_${version}_amd64.deb`
        : `upstand-linux-x64-${version}.zip`;
    const asset = assetNamed(release, name);
    return asset
      ? {
          format: target.linuxInstallKind === "deb" ? "linux-deb" : "linux-zip",
          assets: [asset],
        }
      : null;
  }

  return null;
}

export function getDesktopUpdateInfo(options: {
  currentVersion: string;
  release: DesktopRelease;
  target: DesktopUpdateTarget;
  isPackaged: boolean;
}): { info: DesktopUpdateInfo; plan: DesktopUpdatePlan | null } {
  const updateAvailable =
    compareDesktopVersions(options.release.version, options.currentVersion) > 0;
  const plan = updateAvailable
    ? planDesktopUpdate(options.release, options.target)
    : null;
  const unavailableReason = !updateAvailable
    ? null
    : !options.isPackaged
      ? "Updates are available in the installed desktop app."
      : plan
        ? null
        : "An installer for this operating system and architecture is not available yet.";

  return {
    info: {
      currentVersion: options.currentVersion,
      latestVersion: options.release.version,
      updateAvailable,
      canUpdate: updateAvailable && options.isPackaged && plan !== null,
      releaseUrl: options.release.releaseUrl,
      unavailableReason,
    },
    plan,
  };
}

export async function fetchLatestDesktopRelease(
  fetcher: typeof fetch = fetch,
): Promise<DesktopRelease> {
  const response = await fetcher(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Upstand-Desktop",
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.status === 403 || response.status === 429) {
    throw new Error(
      "GitHub is temporarily limiting update checks. Try again shortly.",
    );
  }
  if (!response.ok) {
    throw new Error(
      `GitHub could not check for updates (HTTP ${response.status})`,
    );
  }
  return parseDesktopRelease((await response.json()) as unknown);
}
