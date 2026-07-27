import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
) as {
  version?: string;
};
const version = packageJson.version;

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(
    `Root package version must be a stable semver value, received: ${version ?? "missing"}`,
  );
}

function git(args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function compareVersions(left: string, right: string) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart !== rightPart) return leftPart - rightPart;
  }
  return 0;
}

const tag = `v${version}`;
const existingTags = git(["tag", "--list", tag]);
let remoteTagExists = false;
try {
  git(["ls-remote", "--exit-code", "origin", `refs/tags/${tag}`]);
  remoteTagExists = true;
} catch {
  remoteTagExists = false;
}

if (existingTags === tag || remoteTagExists) {
  console.log(`${tag} already exists; nothing to tag.`);
  process.exit(0);
}

const latestTag = git(["tag", "--list", "v*", "--sort=-version:refname"])
  .split("\n")
  .find(Boolean);
if (latestTag && compareVersions(version, latestTag.slice(1)) <= 0) {
  throw new Error(`Refusing to create ${tag}: latest release is ${latestTag}.`);
}

git(["config", "user.name", "github-actions[bot]"]);
git([
  "config",
  "user.email",
  "41898282+github-actions[bot]@users.noreply.github.com",
]);
const commit = git(["rev-parse", "HEAD"]);
git(["tag", "-a", tag, commit, "-m", `Release ${tag}`]);
git(["push", "origin", `refs/tags/${tag}`]);
console.log(`Created and pushed ${tag} at ${commit}.`);
