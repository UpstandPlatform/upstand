import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const APPLICATION_ARCHIVE_LIMITS = {
  maxEntries: 10_000,
  maxEntrySize: 512 * 1024 * 1024,
  maxTotalSize: 1024 * 1024 * 1024,
  maxPathLength: 4096,
  maxCompressionRatio: 100,
} as const;

export class ApplicationArchiveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplicationArchiveValidationError";
  }
}

function normalizeArchiveEntry(entry: string): string {
  const normalizedSeparators = entry.replaceAll("\\", "/");
  if (
    !normalizedSeparators ||
    normalizedSeparators.length > APPLICATION_ARCHIVE_LIMITS.maxPathLength
  ) {
    throw new ApplicationArchiveValidationError(
      "Archive contains an empty or excessively long path",
    );
  }
  if (
    normalizedSeparators.startsWith("/") ||
    normalizedSeparators.startsWith("//") ||
    /^[a-zA-Z]:\//.test(normalizedSeparators)
  ) {
    throw new ApplicationArchiveValidationError(
      `Archive entry is absolute: ${entry}`,
    );
  }

  const normalized = path.posix.normalize(normalizedSeparators);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new ApplicationArchiveValidationError(
      `Archive entry escapes the extraction directory: ${entry}`,
    );
  }
  return normalized === "." ? "" : normalized.replace(/\/+$/, "");
}

function parseEntrySize(line: string): number {
  const gnu = line.match(
    /^\S{10}\s+\S+\s+(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/,
  );
  const bsd = line.match(
    /^\S{10}\s+\d+\s+\d+\s+\d+\s+(\d+)\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}/,
  );
  const flexible = line.match(
    /\s+(\d+)\s+(?:[A-Za-z]{3}\s+\d+|\d{4}-\d{2}-\d{2})/,
  );
  const size = Number(gnu?.[1] ?? bsd?.[1] ?? flexible?.[1]);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new ApplicationArchiveValidationError(
      "Archive metadata uses an unsupported tar listing format",
    );
  }
  return size;
}

export function validateApplicationArchiveListings(
  archiveSize: number,
  namesOutput: string,
  detailedOutput: string,
): { entryCount: number; totalSize: number } {
  const names = namesOutput.split(/\r?\n/).filter(Boolean);
  const details = detailedOutput.split(/\r?\n/).filter(Boolean);
  if (names.length !== details.length) {
    throw new ApplicationArchiveValidationError(
      "Archive metadata could not be read consistently",
    );
  }
  if (names.length > APPLICATION_ARCHIVE_LIMITS.maxEntries) {
    throw new ApplicationArchiveValidationError(
      `Archive contains more than ${APPLICATION_ARCHIVE_LIMITS.maxEntries} entries`,
    );
  }

  const seen = new Set<string>();
  let totalSize = 0;
  for (let index = 0; index < names.length; index += 1) {
    const entry = normalizeArchiveEntry(names[index] ?? "");
    const detail = details[index] ?? "";
    const entryType = detail[0];
    if (entryType !== "-" && entryType !== "d") {
      throw new ApplicationArchiveValidationError(
        `Archive entry type is not supported: ${names[index]}`,
      );
    }
    if (entry && seen.has(entry)) {
      throw new ApplicationArchiveValidationError(
        `Archive contains a duplicate path: ${names[index]}`,
      );
    }
    if (entry) seen.add(entry);

    const size = parseEntrySize(detail);
    if (size > APPLICATION_ARCHIVE_LIMITS.maxEntrySize) {
      throw new ApplicationArchiveValidationError(
        `Archive entry exceeds the ${APPLICATION_ARCHIVE_LIMITS.maxEntrySize}-byte limit: ${names[index]}`,
      );
    }
    totalSize += size;
    if (totalSize > APPLICATION_ARCHIVE_LIMITS.maxTotalSize) {
      throw new ApplicationArchiveValidationError(
        `Archive expands beyond the ${APPLICATION_ARCHIVE_LIMITS.maxTotalSize}-byte limit`,
      );
    }
  }

  if (
    archiveSize <= 0 ||
    totalSize / archiveSize > APPLICATION_ARCHIVE_LIMITS.maxCompressionRatio
  ) {
    throw new ApplicationArchiveValidationError(
      "Archive compression ratio exceeds the allowed limit",
    );
  }
  return { entryCount: names.length, totalSize };
}

function validateExtractedTree(root: string): void {
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current)) {
      const entryPath = path.join(current, entry);
      const stats = fs.lstatSync(entryPath);
      if (stats.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (!stats.isFile()) {
        throw new ApplicationArchiveValidationError(
          `Extracted entry type is not supported: ${path.relative(root, entryPath)}`,
        );
      }
    }
  };
  visit(root);
}

export async function extractApplicationArchive(
  archivePath: string,
  dropsDir: string,
): Promise<void> {
  const parentDir = path.dirname(dropsDir);
  const stagingDir = path.join(parentDir, `.staging-${randomUUID()}`);
  const previousDir = path.join(parentDir, `.previous-${randomUUID()}`);
  let movedPrevious = false;
  let movedStaging = false;

  try {
    fs.mkdirSync(stagingDir, { recursive: true });
    const [listing, detailedListing] = await Promise.all([
      execFileAsync("tar", ["-tf", archivePath]),
      execFileAsync("tar", ["-tvf", archivePath]),
    ]);
    validateApplicationArchiveListings(
      fs.statSync(archivePath).size,
      listing.stdout,
      detailedListing.stdout,
    );
    await execFileAsync("tar", ["-xf", archivePath, "-C", stagingDir, "-k"]);
    validateExtractedTree(stagingDir);

    if (fs.existsSync(dropsDir)) {
      fs.renameSync(dropsDir, previousDir);
      movedPrevious = true;
    }
    fs.renameSync(stagingDir, dropsDir);
    movedStaging = true;
  } catch (error) {
    if (movedPrevious && !fs.existsSync(dropsDir)) {
      fs.renameSync(previousDir, dropsDir);
      movedPrevious = false;
    }
    throw error;
  } finally {
    if (!movedStaging) fs.rmSync(stagingDir, { recursive: true, force: true });
    if (movedPrevious) fs.rmSync(previousDir, { recursive: true, force: true });
  }
}
