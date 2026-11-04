import { $ } from "bun";

export type ProductionImage = {
  name: string;
  file: string;
  context?: string;
  build_args: string;
};

const PRODUCTION_IMAGES = [
  { name: "server", file: "apps/server/Dockerfile", build_args: "" },
  {
    name: "web",
    file: "apps/web/Dockerfile",
    build_args:
      "NEXT_PUBLIC_SERVER_URL=https://api.example.invalid\nNEXT_PUBLIC_UPSTAND_VERSION=ci",
  },
  { name: "fumadocs", file: "apps/fumadocs/Dockerfile", build_args: "" },
  { name: "schedules", file: "apps/schedules/Dockerfile", build_args: "" },
  {
    name: "deployment-worker",
    file: "apps/schedules/Dockerfile.worker",
    build_args: "",
  },
  {
    name: "monitoring",
    context: "apps/monitoring",
    file: "apps/monitoring/Dockerfile",
    build_args: "",
  },
  {
    name: "docker-broker",
    context: "apps/docker-broker",
    file: "apps/docker-broker/Dockerfile",
    build_args: "",
  },
] as const satisfies readonly ProductionImage[];

type ProductionImageName = (typeof PRODUCTION_IMAGES)[number]["name"];

const NODE_IMAGES = new Set([
  "server",
  "web",
  "fumadocs",
  "schedules",
  "deployment-worker",
]);

const ROOT_NODE_BUILD_FILES = new Set([
  ".dockerignore",
  "bun.lock",
  "bun.lockb",
  "bunfig.toml",
  "package.json",
  "turbo.json",
  "tsconfig.json",
]);

const DOCUMENTATION_PATHS = [".changeset/", ".github/", "docs/"];

function normalizePath(path: string) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isDocumentationPath(path: string) {
  return (
    DOCUMENTATION_PATHS.some((prefix) => path.startsWith(prefix)) ||
    path.endsWith(".md") ||
    path.endsWith(".mdx")
  );
}

function addNodeImages(names: Set<string>) {
  for (const name of NODE_IMAGES) names.add(name);
}

function addAllImages(names: Set<string>) {
  for (const image of PRODUCTION_IMAGES) names.add(image.name);
}

export function getAffectedProductionImages(changedFiles: readonly string[]) {
  const affectedNames = new Set<string>();

  for (const changedFile of changedFiles) {
    const path = normalizePath(changedFile);
    if (path === ".github/workflows/build-pruned-image.yml") {
      addAllImages(affectedNames);
      continue;
    }
    if (!path || isDocumentationPath(path)) continue;
    if (
      path === "scripts/ci-image-matrix.ts" ||
      path === "scripts/ci-image-matrix.test.ts"
    ) {
      continue;
    }
    if (path.startsWith("apps/desktop/") || path.startsWith("packages/cli/")) {
      continue;
    }

    if (path.startsWith("apps/server/")) {
      affectedNames.add("server");
    } else if (path.startsWith("apps/schedules/")) {
      affectedNames.add("schedules");
      affectedNames.add("deployment-worker");
    } else if (path.startsWith("apps/web/")) {
      affectedNames.add("web");
    } else if (path.startsWith("apps/fumadocs/")) {
      affectedNames.add("fumadocs");
    } else if (path.startsWith("apps/monitoring/")) {
      affectedNames.add("monitoring");
    } else if (path.startsWith("apps/docker-broker/")) {
      affectedNames.add("docker-broker");
    } else if (path.startsWith("packages/")) {
      addNodeImages(affectedNames);
    } else if (ROOT_NODE_BUILD_FILES.has(path)) {
      addNodeImages(affectedNames);
    } else if (path.startsWith("scripts/")) {
      addAllImages(affectedNames);
    } else {
      // Unknown build inputs conservatively rebuild every production image.
      addAllImages(affectedNames);
    }
  }

  return PRODUCTION_IMAGES.filter((image) => affectedNames.has(image.name));
}

export function getProductionImageFlags(
  changedFiles: readonly string[],
): Record<ProductionImageName, boolean> {
  const affectedNames = new Set(
    getAffectedProductionImages(changedFiles).map((image) => image.name),
  );
  return Object.fromEntries(
    PRODUCTION_IMAGES.map((image) => [
      image.name,
      affectedNames.has(image.name),
    ]),
  ) as Record<ProductionImageName, boolean>;
}

async function getChangedFiles(baseSha: string, headSha: string) {
  const diff =
    await $`git diff --name-only ${`${baseSha}...${headSha}`}`.text();
  return diff.split(/\r?\n/).filter(Boolean);
}

async function main() {
  const [baseSha, headSha] = Bun.argv.slice(2);
  if (!baseSha || !headSha) {
    throw new Error("Pass a base and head commit SHA, or 'all' for both.");
  }

  const changedFiles =
    baseSha === "all" && headSha === "all"
      ? PRODUCTION_IMAGES.map((image) => image.file)
      : await getChangedFiles(baseSha, headSha);

  console.log(JSON.stringify(getProductionImageFlags(changedFiles)));
}

if (import.meta.main) await main();
