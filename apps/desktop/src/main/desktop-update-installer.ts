import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  DesktopUpdateAsset,
  DesktopUpdateProgress,
} from "./desktop-updates";

export type PreparedDesktopUpdate = {
  directory: string;
  filePath: string;
};

export type DownloadDesktopUpdateOptions = {
  fetcher?: UpdateFetcher;
  onProgress?: (progress: DesktopUpdateProgress) => void;
  temporaryDirectory?: string;
};

const allowedDownloadHosts = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
const downloadTimeoutMs = 30 * 60 * 1000;
type UpdateFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export async function downloadVerifiedDesktopUpdate(
  asset: DesktopUpdateAsset,
  options: DownloadDesktopUpdateOptions = {},
): Promise<PreparedDesktopUpdate> {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(asset.downloadUrl, {
    headers: { "User-Agent": "Upstand-Desktop" },
    signal: AbortSignal.timeout(downloadTimeoutMs),
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `GitHub could not download the update (HTTP ${response.status})`,
    );
  }

  const finalUrl = new URL(response.url || asset.downloadUrl);
  if (
    finalUrl.protocol !== "https:" ||
    finalUrl.username !== "" ||
    finalUrl.password !== "" ||
    (finalUrl.port !== "" && finalUrl.port !== "443") ||
    !allowedDownloadHosts.has(finalUrl.hostname)
  ) {
    throw new Error(
      "GitHub redirected the update to an untrusted download host",
    );
  }

  const advertisedLength = response.headers.get("content-length");
  if (
    advertisedLength &&
    Number.isSafeInteger(Number(advertisedLength)) &&
    Number(advertisedLength) !== asset.size
  ) {
    throw new Error("The update size does not match its release metadata");
  }

  const directory = await mkdtemp(
    join(options.temporaryDirectory ?? tmpdir(), "upstand-update-"),
  );
  const filePath = join(directory, asset.name);
  const hash = createHash("sha256");
  let downloadedBytes = 0;
  const progress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloadedBytes += chunk.length;
      if (downloadedBytes > asset.size) {
        callback(new Error("The downloaded update is larger than expected"));
        return;
      }
      hash.update(chunk);
      options.onProgress?.({
        phase: "downloading",
        downloadedBytes,
        totalBytes: asset.size,
        percent: Math.min(
          100,
          Math.floor((downloadedBytes / asset.size) * 100),
        ),
      });
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(
        response.body as unknown as import("node:stream/web").ReadableStream,
      ),
      progress,
      createWriteStream(filePath, { flags: "wx", mode: 0o600 }),
    );
    if (downloadedBytes !== asset.size) {
      throw new Error("The downloaded update is incomplete");
    }
    if (hash.digest("hex") !== asset.sha256) {
      throw new Error("The downloaded update failed its SHA-256 verification");
    }
    return { directory, filePath };
  } catch (error) {
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
}

export async function removePreparedDesktopUpdate(
  update: PreparedDesktopUpdate,
): Promise<void> {
  await rm(update.directory, { force: true, recursive: true });
}
