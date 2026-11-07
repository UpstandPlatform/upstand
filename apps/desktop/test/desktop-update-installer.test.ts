import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadVerifiedDesktopUpdate } from "../src/main/desktop-update-installer";
import type { DesktopUpdateAsset } from "../src/main/desktop-updates";

const body = Buffer.from("update payload");
const asset: DesktopUpdateAsset = {
  name: "upstand-darwin-arm64-1.2.3.zip",
  size: body.byteLength,
  sha256: createHash("sha256").update(body).digest("hex"),
  downloadUrl:
    "https://github.com/UpstandPlatform/upstand/releases/download/v1.2.3/upstand-darwin-arm64-1.2.3.zip",
};

function response(content: Buffer, url?: string): Response {
  const result = new Response(content.toString("utf8"), {
    headers: { "content-length": String(content.byteLength) },
  });
  if (url) Object.defineProperty(result, "url", { value: url });
  return result;
}

describe("verified desktop update download", () => {
  test("streams the expected asset, verifies its digest, and reports progress", async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "upstand-update-test-"),
    );
    const progress: number[] = [];
    try {
      const update = await downloadVerifiedDesktopUpdate(asset, {
        temporaryDirectory,
        fetcher: async () => response(body),
        onProgress: (value) => {
          if (value.percent !== null) progress.push(value.percent);
        },
      });
      expect(await readFile(update.filePath)).toEqual(body);
      expect(progress.at(-1)).toBe(100);
      await rm(update.directory, { force: true, recursive: true });
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("rejects a redirected asset from an untrusted host before writing it", async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "upstand-update-test-"),
    );
    try {
      await expect(
        downloadVerifiedDesktopUpdate(asset, {
          temporaryDirectory,
          fetcher: async () =>
            response(body, "https://example.invalid/payload"),
        }),
      ).rejects.toThrow("untrusted download host");
      expect(await readdir(temporaryDirectory)).toEqual([]);
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("rejects nonstandard ports even on an approved download hostname", async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "upstand-update-test-"),
    );
    try {
      await expect(
        downloadVerifiedDesktopUpdate(asset, {
          temporaryDirectory,
          fetcher: async () =>
            response(
              body,
              "https://github.com:8443/UpstandPlatform/upstand/releases/download/v1.2.3/update.zip",
            ),
        }),
      ).rejects.toThrow("untrusted download host");
      expect(await readdir(temporaryDirectory)).toEqual([]);
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("rejects a payload whose digest differs from release metadata", async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "upstand-update-test-"),
    );
    try {
      await expect(
        downloadVerifiedDesktopUpdate(
          { ...asset, sha256: "0".repeat(64) },
          {
            temporaryDirectory,
            fetcher: async () => response(body),
          },
        ),
      ).rejects.toThrow("SHA-256 verification");
      expect(await readdir(temporaryDirectory)).toEqual([]);
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("rejects an incomplete or unexpected asset size", async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "upstand-update-test-"),
    );
    try {
      await expect(
        downloadVerifiedDesktopUpdate(
          { ...asset, size: body.byteLength + 1 },
          {
            temporaryDirectory,
            fetcher: async () => response(body),
          },
        ),
      ).rejects.toThrow("size does not match");
      expect(await readdir(temporaryDirectory)).toEqual([]);
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
