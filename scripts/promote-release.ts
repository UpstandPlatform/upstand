import { execFileSync } from "node:child_process";

const root = process.cwd();

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function gh(args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync("gh", args, { cwd: root, encoding: "utf8", env }).trim();
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart !== rightPart) return leftPart - rightPart;
  }
  return 0;
}

git(["fetch", "origin", "canary", "master", "--tags", "--prune"]);

// Read version from origin/canary package.json
const canaryPkgJsonStr = git(["show", "origin/canary:package.json"]);
const canaryPkg = JSON.parse(canaryPkgJsonStr) as { version?: string };
const version = canaryPkg.version;

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Invalid version on canary: ${version ?? "missing"}`);
}

const tag = `v${version}`;

// Check if tag already exists
const existingTags = git(["tag", "--list", tag]);
let remoteTagExists = false;
try {
  git(["ls-remote", "--exit-code", "origin", `refs/tags/${tag}`]);
  remoteTagExists = true;
} catch {
  remoteTagExists = false;
}

if (existingTags === tag || remoteTagExists) {
  console.log(`${tag} is already tagged and released; nothing to promote.`);
  process.exit(0);
}

// Check latest tag
const latestTag = git(["tag", "--list", "v*", "--sort=-version:refname"])
  .split("\n")
  .find(Boolean);
if (latestTag && compareVersions(version, latestTag.slice(1)) <= 0) {
  console.log(
    `Canary version (${version}) is not newer than latest tag (${latestTag}); skipping promotion.`,
  );
  process.exit(0);
}

const branchName = `release/promote-v${version}`;

// Check if a PR already exists for this version promotion
try {
  const existingPrs = gh([
    "pr",
    "list",
    "--base",
    "master",
    "--head",
    branchName,
    "--json",
    "number,state",
  ]);
  const prList = JSON.parse(existingPrs) as Array<{
    number: number;
    state: string;
  }>;
  if (prList.length > 0 && prList[0]?.state === "OPEN") {
    console.log(
      `Promotion PR #${prList[0].number} for ${tag} already exists and is open.`,
    );
    process.exit(0);
  }
} catch {
  // gh cli might fail or not be authenticated; continue
}

console.log(`Promoting canary (${tag}) to master without divergence...`);

// Switch to promotion branch branched directly from origin/master
git(["checkout", "-B", branchName, "origin/master"]);

// Apply exact tree from origin/canary
git(["checkout", "origin/canary", "--", "."]);

// Check if there are changes against origin/master
const status = git(["status", "--porcelain"]);
if (!status) {
  console.log(
    `Working tree on origin/master is already identical to origin/canary for ${tag}.`,
  );
  process.exit(0);
}

git(["config", "user.name", "github-actions[bot]"]);
git([
  "config",
  "user.email",
  "41898282+github-actions[bot]@users.noreply.github.com",
]);

git(["commit", "-m", `release: promote ${tag}`]);
git(["push", "-u", "origin", branchName, "--force"]);
console.log(`Pushed ${branchName} to origin.`);

try {
  const prUrl = gh([
    "pr",
    "create",
    "--base",
    "master",
    "--head",
    branchName,
    "--title",
    `release: promote ${tag}`,
    "--body",
    `Automated promotion of **${tag}** from \`canary\` to \`master\`.\n\nRooted on \`origin/master\` with exact tree from \`origin/canary\` to avoid 3-way merge conflicts.`,
  ]);
  console.log(`Created promotion PR: ${prUrl}`);
} catch (_error) {
  console.log(
    `Branch pushed. If PR was not automatically opened, open it via: gh pr create --base master --head ${branchName}`,
  );
}
