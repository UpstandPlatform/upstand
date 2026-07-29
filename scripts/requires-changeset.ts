import { execFileSync } from "node:child_process";

const baseRef = process.argv[2];

if (!baseRef) {
  throw new Error("Usage: bun scripts/requires-changeset.ts <base-ref>");
}

function git(args: string[]) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
}

function readJsonAt(ref: string, path: string) {
  return JSON.parse(git(["show", `${ref}:${path}`])) as Record<string, unknown>;
}

function isProductionManifestChange(path: string) {
  try {
    const before = readJsonAt(baseRef, path);
    const after = readJsonAt("HEAD", path);

    // Development tooling, scripts, and the package-manager declaration do
    // not change a shipped artifact. Everything else in a manifest can.
    for (const key of ["devDependencies", "scripts", "packageManager"]) {
      delete before[key];
      delete after[key];
    }

    return JSON.stringify(before) !== JSON.stringify(after);
  } catch {
    // Added, removed, or malformed manifests need a maintainer-reviewed
    // Changeset instead of being silently excluded from the release gate.
    return true;
  }
}

const changedFiles = git(["diff", "--name-only", `${baseRef}...HEAD`])
  .split("\n")
  .filter(Boolean);

const sourceChanged = changedFiles.some((path) =>
  /^(apps|packages)\/[^/]+\/(src|content|public)\//.test(path),
);
const manifestChanged = changedFiles
  .filter(
    (path) =>
      path === "package.json" ||
      /^(apps|packages)\/[^/]+\/package\.json$/.test(path),
  )
  .some(isProductionManifestChange);

process.stdout.write(`${sourceChanged || manifestChanged}\n`);
