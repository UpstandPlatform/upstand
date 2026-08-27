import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  consumeChangesetFiles,
  mergeReleaseNotesIntoChangelog,
} from "./version-release-helpers";

const root = process.cwd();
const changesetDirectory = join(root, ".changeset");
const deployablePackages = ["server", "schedules", "web", "fumadocs"] as const;

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function writeJson(path: string, value: Record<string, unknown>) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function runChangesetVersion() {
  const result = Bun.spawnSync(
    [process.execPath, "x", "changeset", "version"],
    {
      cwd: root,
      stderr: "inherit",
      stdout: "inherit",
    },
  );

  if (result.exitCode !== 0) {
    process.exit(result.exitCode);
  }
}

const changesetFiles = readdirSync(changesetDirectory)
  .filter((file) => file.endsWith(".md") && file !== "README.md")
  .map((file) => join(changesetDirectory, file));

if (changesetFiles.length === 0) {
  console.log(
    "No pending changesets; version files and changelog are unchanged.",
  );
  process.exit(0);
}

const releaseNotes = changesetFiles
  .map((path) =>
    readFileSync(path, "utf8").split("---").slice(2).join("---").trim(),
  )
  .filter(Boolean);

runChangesetVersion();

const versions = deployablePackages.map((packageName) => {
  const packageJson = readJson(join(root, "apps", packageName, "package.json"));
  return String(packageJson.version ?? "");
});

if (versions.some((version) => !version) || new Set(versions).size !== 1) {
  throw new Error(
    `Deployable package versions must stay aligned: ${versions.join(", ")}`,
  );
}

const releaseVersion = versions[0];
const rootPackagePath = join(root, "package.json");
const rootPackage = readJson(rootPackagePath);
rootPackage.version = releaseVersion;
writeJson(rootPackagePath, rootPackage);

const changelogPath = join(root, "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf8");
const lineEnding = changelog.includes("\r\n") ? "\r\n" : "\n";
const updatedChangelog = mergeReleaseNotesIntoChangelog(
  changelog,
  releaseVersion,
  releaseNotes,
  new Date().toISOString().slice(0, 10),
);
if (updatedChangelog !== changelog.replaceAll("\r\n", "\n")) {
  writeFileSync(changelogPath, updatedChangelog.replaceAll("\n", lineEnding));
}

consumeChangesetFiles(changesetFiles);

console.log(
  `Prepared ${releaseVersion} with ${releaseNotes.length} changeset note(s).`,
);
