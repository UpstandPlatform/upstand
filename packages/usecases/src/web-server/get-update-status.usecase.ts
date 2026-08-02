import fs from "node:fs";
import path from "node:path";
import { env } from "@upstand/env/server";
import { readResponseJsonLimited } from "@upstand/platform/network/response-body";
import { log } from "evlog";
import { requiresRemoteServerPlacement } from "../platform/platform.types";

export interface UpdateStatusResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  channel: "stable" | "canary" | "source" | "managed";
  canUpdate: boolean;
  checkedAt: string;
  images: {
    server: string;
    schedules: string;
    web: string;
    fumadocs: string;
    monitoring: string;
  } | null;
}

const RELEASE_MANIFEST_ASSET = "upstand-release-manifest.json";
const REQUIRED_IMAGES = [
  "server",
  "schedules",
  "web",
  "fumadocs",
  "monitoring",
] as const;

type GitHubRelease = {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: Array<{
    name?: string;
    browser_download_url?: string;
  }>;
};

type ReleaseManifest = {
  schemaVersion?: number;
  version?: string;
  images?: Array<{
    name?: string;
    image?: string;
    digest?: string;
  }>;
};

let cachedStatus: {
  result: UpdateStatusResult;
  expiresAt: number;
  key: string;
} | null = null;

const VERSION_PATTERN = /^(?:v)?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i;

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function isTrustedReleaseAssetUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "github.com" ||
        url.hostname === "objects.githubusercontent.com" ||
        url.hostname.endsWith(".githubusercontent.com"))
    );
  } catch {
    return false;
  }
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = value.trim().match(VERSION_PATTERN);
    return match ? match.slice(1, 4).map(Number) : null;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    const leftPart = a[index] ?? 0;
    const rightPart = b[index] ?? 0;
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function unavailableStatus(
  currentVersion: string,
  channel: UpdateStatusResult["channel"],
  checkedAt: string,
): UpdateStatusResult {
  return {
    currentVersion,
    latestVersion: currentVersion,
    updateAvailable: false,
    channel,
    canUpdate: channel !== "source",
    checkedAt,
    images: null,
  };
}

function isCompleteRelease(
  version: string | undefined,
  manifest: ReleaseManifest,
  repo: string,
): boolean {
  if (
    !version ||
    manifest.schemaVersion !== 1 ||
    manifest.version !== version
  ) {
    return false;
  }

  const images = new Map(
    (manifest.images ?? []).map((image) => [image.name, image]),
  );
  return REQUIRED_IMAGES.every((name) => {
    const image = images.get(name);
    return (
      image?.image === `ghcr.io/${repo}-${name}:${version}` &&
      typeof image.digest === "string" &&
      /^sha256:[a-f0-9]{64}$/i.test(image.digest)
    );
  });
}

export class GetUpdateStatusUseCase {
  async execute(options?: {
    forceRefresh?: boolean;
    fetcher?: typeof fetch;
    repository?: string;
  }): Promise<UpdateStatusResult> {
    // Cloud control planes are updated by the hosting rollout. Exposing the
    // self-hosted mutation here would let a tenant race that rollout and
    // could also make the UI suggest that a managed instance is stale.
    if (requiresRemoteServerPlacement()) {
      const managedVersion = env.UPSTAND_VERSION || "managed";
      return {
        currentVersion: managedVersion,
        latestVersion: managedVersion,
        updateAvailable: false,
        channel: "managed",
        canUpdate: false,
        checkedAt: new Date().toISOString(),
        images: null,
      };
    }
    const requestFetch = options?.fetcher ?? fetch;
    let currentVersion = env.UPSTAND_VERSION;
    if (!currentVersion) {
      try {
        const rootPkgPath = path.join(process.cwd(), "package.json");
        if (fs.existsSync(rootPkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
          currentVersion = pkg.version ? `v${pkg.version}` : undefined;
        }
      } catch {}
    }
    if (!currentVersion) currentVersion = "source-local";

    const currentImage = env.UPSTAND_SERVER_IMAGE || "";
    const channel: UpdateStatusResult["channel"] = currentImage.includes(
      ":canary",
    )
      ? "canary"
      : currentImage.includes(":source-")
        ? "source"
        : "stable";
    const checkedAt = new Date().toISOString();
    const repo = options?.repository || env.GITHUB_REPOSITORY;

    const now = Date.now();
    const cacheKey = `${channel}:${currentVersion}:${repo}`;
    if (
      cachedStatus &&
      cachedStatus.expiresAt > now &&
      cachedStatus.key === cacheKey &&
      !options?.forceRefresh
    ) {
      return cachedStatus.result;
    }

    try {
      const endpoint =
        channel === "canary"
          ? `https://api.github.com/repos/${repo}/releases?per_page=30`
          : `https://api.github.com/repos/${repo}/releases/latest`;

      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "Upstand",
      };
      const token = env.UPSTAND_GITHUB_TOKEN || env.GITHUB_TOKEN;
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      let latestVersion: string | null = null;
      let manifest: ReleaseManifest | null = null;

      try {
        const response = await requestFetch(endpoint, {
          cache: "no-store",
          headers,
        });

        if (response.ok) {
          const data = await readResponseJsonLimited<
            GitHubRelease | GitHubRelease[]
          >(response);
          const release = Array.isArray(data)
            ? data.find((candidate) =>
                channel === "canary"
                  ? candidate.prerelease === true
                  : candidate.prerelease !== true,
              )
            : data;
          if (release && !release.draft && release.tag_name) {
            latestVersion = release.tag_name;
            const manifestAsset = release.assets?.find(
              (asset) => asset.name === RELEASE_MANIFEST_ASSET,
            );
            if (
              manifestAsset?.browser_download_url &&
              isTrustedReleaseAssetUrl(manifestAsset.browser_download_url)
            ) {
              const manifestResponse = await requestFetch(
                manifestAsset.browser_download_url,
                {
                  cache: "no-store",
                  headers: {
                    Accept: "application/json",
                    "User-Agent": "Upstand",
                  },
                },
              );
              if (manifestResponse.ok) {
                manifest =
                  await readResponseJsonLimited<ReleaseManifest>(
                    manifestResponse,
                  );
              }
            }
          }
        } else {
          log.warn({
            message: `GitHub API returned ${response.status} when checking for updates.`,
          });
        }
      } catch (apiErr: unknown) {
        log.warn({
          message:
            "Failed to connect to GitHub API, checking redirect fallback",
          err: errorMessage(apiErr),
        });
      }

      // Fallback: If GitHub API failed, was rate-limited (e.g. 403/429), or returned no manifest, and we are on stable channel
      if ((!latestVersion || !manifest) && channel === "stable") {
        log.info({
          message:
            "Attempting GitHub HTTP redirect fallback to check for updates...",
        });
        try {
          const redirectRes = await requestFetch(
            `https://github.com/${repo}/releases/latest`,
            {
              redirect: "manual",
              headers: {
                "User-Agent": "Upstand",
              },
            },
          );
          const location = redirectRes.headers.get("location");
          if (location) {
            const parts = location.split("/tag/");
            const tagPart = parts[1];
            if (tagPart) {
              const tag = tagPart.trim();
              const manifestUrl = `https://github.com/${repo}/releases/download/${tag}/${RELEASE_MANIFEST_ASSET}`;
              const manifestResponse = await requestFetch(manifestUrl, {
                cache: "no-store",
                headers: {
                  Accept: "application/json",
                  "User-Agent": "Upstand",
                },
              });
              if (manifestResponse.ok) {
                latestVersion = tag;
                manifest =
                  await readResponseJsonLimited<ReleaseManifest>(
                    manifestResponse,
                  );
              }
            }
          }
        } catch (fallbackErr: unknown) {
          log.warn({
            message: "GitHub redirect fallback check failed",
            err: errorMessage(fallbackErr),
          });
        }
      }

      if (
        !latestVersion ||
        !manifest ||
        !isCompleteRelease(latestVersion, manifest, repo)
      ) {
        log.warn({
          message:
            "Could not find a valid release or release manifest for update check.",
          version: latestVersion,
        });
        return unavailableStatus(currentVersion, channel, checkedAt);
      }

      const images = new Map(
        (manifest.images ?? []).map((image) => [image.name, image]),
      );
      const verifiedImages = Object.fromEntries(
        REQUIRED_IMAGES.map((name) => [
          name,
          (images.get(name)?.digest || "").toLowerCase(),
        ]),
      ) as UpdateStatusResult["images"];

      const updateAvailable =
        compareVersions(latestVersion, currentVersion) > 0;

      const result: UpdateStatusResult = {
        currentVersion,
        latestVersion,
        updateAvailable,
        channel,
        canUpdate: channel !== "source",
        checkedAt,
        images: verifiedImages,
      };

      cachedStatus = {
        result,
        expiresAt: now + 30 * 60 * 1000,
        key: cacheKey,
      };

      return result;
    } catch (err: unknown) {
      log.error({
        message: "Failed to check for updates from GitHub",
        err,
      });
      return unavailableStatus(currentVersion, channel, checkedAt);
    }
  }
}
