import { describe, expect, test } from "bun:test";
import path from "node:path";

type ArchitectureRole =
  | "application"
  | "composition"
  | "configuration"
  | "domain"
  | "host"
  | "infrastructure"
  | "interface"
  | "platform"
  | "runtime-infrastructure"
  | "tooling";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name: string;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface WorkspacePackage {
  dependencies: Set<string>;
  name: string;
  path: string;
  productionDependencies: Set<string>;
  role: ArchitectureRole;
  root: string;
}

interface SourceFile {
  relativePath: string;
  source: string;
}

const workspaceRoot = path.resolve(import.meta.dir, "../../..");
const sourceGlob = new Bun.Glob("{apps,packages}/*/src/**/*.{ts,tsx}");
const packageGlob = new Bun.Glob("{apps,packages}/*/package.json");
const canonicalTokenFiles = new Set([
  "packages/repositories/src/tokens.ts",
  "packages/usecases/src/tokens.ts",
]);

/**
 * This is the single executable definition of the package architecture.
 *
 * Application runtime concerns that have not yet been ported out of
 * `@upstand/usecases` are deliberately represented by `platform` and
 * `runtime-infrastructure`. That keeps the current boundary explicit and
 * prevents any new dependency direction from being introduced accidentally.
 */
const roleRules: Record<
  ArchitectureRole,
  { allowedDependencies: readonly ArchitectureRole[] }
> = {
  domain: { allowedDependencies: ["tooling"] },
  application: {
    allowedDependencies: [
      "configuration",
      "domain",
      "platform",
      "runtime-infrastructure",
      "tooling",
    ],
  },
  platform: { allowedDependencies: ["configuration", "tooling"] },
  "runtime-infrastructure": {
    allowedDependencies: ["configuration", "tooling"],
  },
  infrastructure: {
    allowedDependencies: [
      "application",
      "configuration",
      "domain",
      "infrastructure",
      "platform",
      "runtime-infrastructure",
      "tooling",
    ],
  },
  interface: { allowedDependencies: ["domain", "tooling"] },
  composition: {
    allowedDependencies: [
      "application",
      "composition",
      "configuration",
      "domain",
      "infrastructure",
      "platform",
      "runtime-infrastructure",
      "tooling",
    ],
  },
  configuration: { allowedDependencies: ["tooling"] },
  tooling: { allowedDependencies: [] },
  host: {
    allowedDependencies: [
      "application",
      "composition",
      "configuration",
      "domain",
      "infrastructure",
      "interface",
      "platform",
      "runtime-infrastructure",
      "tooling",
    ],
  },
};

const packageRoles: Record<string, ArchitectureRole> = {
  "@upstand/api": "composition",
  "@upstand/auth": "composition",
  "@upstand/config": "tooling",
  "@upstand/db": "infrastructure",
  "@upstand/domain": "domain",
  "@upstand/env": "configuration",
  "@upstand/infrastructure": "infrastructure",
  "@upstand/platform": "platform",
  "@upstand/redis": "runtime-infrastructure",
  "@upstand/repositories": "infrastructure",
  "@upstand/ui": "interface",
  "@upstand/usecases": "application",
  fumadocs: "host",
  schedules: "host",
  server: "host",
  web: "host",
};

function workspacePackageName(specifier: string): string | undefined {
  const match = specifier.match(/^(@upstand\/[^/]+)/);
  return match?.[1];
}

function importSpecifiers(source: string): string[] {
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\s+\(\s*["']([^"']+)["']\s*\)/g,
  ];
  const specifiers = new Set<string>();

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.add(match[1]);
    }
  }

  return [...specifiers];
}

function isTestFile(relativePath: string): boolean {
  return relativePath.includes(".test.") || relativePath.includes("/testing/");
}

async function sourceFiles(): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  for await (const relativePath of sourceGlob.scan({
    cwd: workspaceRoot,
    onlyFiles: true,
  })) {
    const normalizedPath = relativePath.replaceAll("\\", "/");
    if (normalizedPath === "packages/config/src/architecture.test.ts") continue;
    files.push({
      relativePath: normalizedPath,
      source: await Bun.file(path.join(workspaceRoot, relativePath)).text(),
    });
  }
  return files;
}

async function workspacePackages(): Promise<WorkspacePackage[]> {
  const packages: WorkspacePackage[] = [];
  for await (const packagePath of packageGlob.scan({
    cwd: workspaceRoot,
    onlyFiles: true,
  })) {
    const normalizedPath = packagePath.replaceAll("\\", "/");
    const manifest = (await Bun.file(
      path.join(workspaceRoot, packagePath),
    ).json()) as PackageJson;
    const root = path.posix.dirname(normalizedPath);
    const dependencies = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);

    packages.push({
      dependencies,
      name: manifest.name,
      path: normalizedPath,
      productionDependencies: new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ]),
      role: packageRoles[manifest.name] as ArchitectureRole,
      root,
    });
  }
  return packages;
}

function packageForSource(
  relativePath: string,
  packages: WorkspacePackage[],
): WorkspacePackage | undefined {
  return packages.find(({ root }) => relativePath.startsWith(`${root}/src/`));
}

function workspaceImportDependencies(
  source: string,
  packages: Set<string>,
): string[] {
  return importSpecifiers(source).flatMap((specifier) => {
    const dependency = workspacePackageName(specifier);
    return dependency && packages.has(dependency) ? [dependency] : [];
  });
}

function findDependencyCycles(packages: WorkspacePackage[]): string[] {
  const byName = new Map(
    packages.map((workspacePackage) => [
      workspacePackage.name,
      workspacePackage,
    ]),
  );
  const cycles: string[] = [];
  const visited = new Set<string>();
  const active = new Set<string>();

  const visit = (packageName: string, chain: string[]) => {
    if (active.has(packageName)) {
      const cycleStart = chain.indexOf(packageName);
      cycles.push([...chain.slice(cycleStart), packageName].join(" -> "));
      return;
    }
    if (visited.has(packageName)) return;

    active.add(packageName);
    const workspacePackage = byName.get(packageName);
    for (const dependency of workspacePackage?.productionDependencies ?? []) {
      if (byName.has(dependency)) visit(dependency, [...chain, packageName]);
    }
    active.delete(packageName);
    visited.add(packageName);
  };

  for (const workspacePackage of packages) visit(workspacePackage.name, []);
  return cycles;
}

const workspaceSources = sourceFiles();
const workspacePackageManifests = workspacePackages();

describe("clean architecture boundaries", () => {
  test("every workspace package is classified by the architecture policy", async () => {
    const manifests = await workspacePackageManifests;

    expect(manifests.map(({ name }) => name).sort()).toEqual(
      Object.keys(packageRoles).sort(),
    );
  });

  test("workspace imports are declared and flow only in approved directions", async () => {
    const packages = await workspacePackageManifests;
    const packageNames = new Set(packages.map(({ name }) => name));
    const packagesByName = new Map(
      packages.map((workspacePackage) => [
        workspacePackage.name,
        workspacePackage,
      ]),
    );
    const violations = (await workspaceSources).flatMap(
      ({ relativePath, source }) => {
        const from = packageForSource(relativePath, packages);
        if (!from) return [`${relativePath}: source is outside a package root`];

        return workspaceImportDependencies(source, packageNames).flatMap(
          (dependency) => {
            if (dependency === from.name) return [];
            const target = packagesByName.get(dependency);
            if (!target) return [`${relativePath}: unknown ${dependency}`];

            const violations: string[] = [];
            if (!from.dependencies.has(dependency)) {
              violations.push(`${relativePath}: undeclared ${dependency}`);
            }
            if (
              !isTestFile(relativePath) &&
              !from.productionDependencies.has(dependency)
            ) {
              violations.push(
                `${relativePath}: ${dependency} must be a production dependency`,
              );
            }
            if (
              !roleRules[from.role].allowedDependencies.includes(target.role)
            ) {
              violations.push(
                `${relativePath}: ${from.role} cannot depend on ${target.role} (${dependency})`,
              );
            }
            return violations;
          },
        );
      },
    );

    expect(violations).toEqual([]);
  });

  test("package source never reaches across a workspace boundary by file path", async () => {
    const packages = await workspacePackageManifests;
    const violations = (await workspaceSources).flatMap(
      ({ relativePath, source }) => {
        const workspacePackage = packageForSource(relativePath, packages);
        if (!workspacePackage) return [relativePath];

        return importSpecifiers(source).flatMap((specifier) => {
          if (
            specifier.startsWith("@upstand/") &&
            specifier.includes("/src/")
          ) {
            return [`${relativePath}: private source import ${specifier}`];
          }
          if (!specifier.startsWith(".")) return [];

          const importedPath = path.posix.normalize(
            path.posix.join(path.posix.dirname(relativePath), specifier),
          );
          return importedPath.startsWith(`${workspacePackage.root}/`)
            ? []
            : [
                `${relativePath}: relative import escapes package (${specifier})`,
              ];
        });
      },
    );

    expect(violations).toEqual([]);
  });

  test("workspace production dependency graph is acyclic", async () => {
    expect(findDependencyCycles(await workspacePackageManifests)).toEqual([]);
  });

  test("domain remains framework and runtime independent", async () => {
    const allowedImports = new Set(["zod"]);
    const violations = (await workspaceSources)
      .filter(
        ({ relativePath }) =>
          relativePath.startsWith("packages/domain/src/") &&
          !isTestFile(relativePath),
      )
      .flatMap(({ relativePath, source }) =>
        importSpecifiers(source).flatMap((specifier) => {
          if (specifier.startsWith(".")) return [];
          return allowedImports.has(specifier)
            ? []
            : [`${relativePath}: ${specifier}`];
        }),
      );

    expect(violations).toEqual([]);
  });

  test("application code cannot import interface or infrastructure packages", async () => {
    const forbiddenDependencies = [
      "api",
      "auth",
      "db",
      "infrastructure",
      "repositories",
      "ui",
    ];
    const forbiddenImport = new RegExp(
      `^@upstand/(?:${forbiddenDependencies.join("|")})(?:/|$)`,
    );
    const violations = (await workspaceSources)
      .filter(({ relativePath }) =>
        relativePath.startsWith("packages/usecases/src/"),
      )
      .flatMap(({ relativePath, source }) =>
        importSpecifiers(source)
          .filter((specifier) => forbiddenImport.test(specifier))
          .map((specifier) => `${relativePath}: ${specifier}`),
      );

    expect(violations).toEqual([]);
  });

  test("notification delivery is an application port with an infrastructure adapter", async () => {
    const applicationNotificationSources = (await workspaceSources).filter(
      ({ relativePath }) =>
        relativePath.startsWith("packages/usecases/src/notification/"),
    );
    const port = await Bun.file(
      path.join(
        workspaceRoot,
        "packages/usecases/src/notification/notification-transport.port.ts",
      ),
    ).text();
    const adapter = await Bun.file(
      path.join(
        workspaceRoot,
        "packages/infrastructure/src/notification/notification-transport.ts",
      ),
    ).text();

    expect(
      applicationNotificationSources
        .filter(({ source }) => source.includes("nodemailer"))
        .map(({ relativePath }) => relativePath),
    ).toEqual([]);
    expect(port).toContain("export interface NotificationTransport");
    expect(port).not.toContain("class NotificationTransportRegistry");
    expect(adapter).toContain("class NotificationTransportRegistry");
    expect(adapter).toContain(
      "@upstand/usecases/notification/notification-transport.port",
    );
  });

  test("Turborepo tags mirror the architecture policy", async () => {
    const rootTurbo = (await Bun.file(
      path.join(workspaceRoot, "turbo.json"),
    ).json()) as {
      boundaries?: {
        tags?: Record<
          string,
          { dependencies?: { allow?: readonly ArchitectureRole[] } }
        >;
      };
    };
    const configuredTags = rootTurbo.boundaries?.tags;
    const tagViolations: string[] = [];

    for (const [role, rule] of Object.entries(roleRules)) {
      const configured = configuredTags?.[role]?.dependencies?.allow ?? [];
      if (
        JSON.stringify([...configured].sort()) !==
        JSON.stringify([...rule.allowedDependencies].sort())
      ) {
        tagViolations.push(role);
      }
    }

    const packageTagViolations: string[] = [];
    for (const workspacePackage of await workspacePackageManifests) {
      const packageTurboPath = path.join(
        workspaceRoot,
        workspacePackage.root,
        "turbo.json",
      );
      const packageTurbo = (await Bun.file(packageTurboPath).json()) as {
        tags?: string[];
      };
      if (
        JSON.stringify(packageTurbo.tags) !==
        JSON.stringify([workspacePackage.role])
      ) {
        packageTagViolations.push(workspacePackage.name);
      }
    }

    expect(tagViolations).toEqual([]);
    expect(packageTagViolations).toEqual([]);
  });
});

describe("dependency injection tokens", () => {
  test("tokens are declared only in their canonical modules", async () => {
    const violations = (await workspaceSources)
      .filter(
        ({ relativePath, source }) =>
          source.includes("createToken") &&
          !canonicalTokenFiles.has(relativePath),
      )
      .map(({ relativePath }) => relativePath);

    expect(violations).toEqual([]);
  });

  test("canonical token exports use a Token suffix and unique symbolic names", async () => {
    const exportedNames: string[] = [];
    const symbolicNames = new Map<string, string>();
    const duplicates: string[] = [];
    const tokenNamePattern = /createToken(?:<[\s\S]*?>)?\(\s*"([^"]+)"/g;

    for (const relativePath of canonicalTokenFiles) {
      const source = await Bun.file(
        path.join(workspaceRoot, relativePath),
      ).text();
      for (const match of source.matchAll(
        /export const (\w+)\s*=\s*createToken/g,
      )) {
        if (match[1]) exportedNames.push(match[1]);
      }
      for (const match of source.matchAll(tokenNamePattern)) {
        const name = match[1];
        if (!name) continue;
        const existing = symbolicNames.get(name);
        if (existing) duplicates.push(`${name}: ${existing}, ${relativePath}`);
        else symbolicNames.set(name, relativePath);
      }
    }

    expect(exportedNames.every((name) => name.endsWith("Token"))).toBe(true);
    expect(duplicates).toEqual([]);
  });

  test("tokens are imported from their canonical modules, never a barrel", async () => {
    const violations: string[] = [];
    const barrelImportPattern =
      /import\s*{([^}]*)}\s*from\s*["']@upstand\/(usecases|repositories)["']/g;

    for (const { relativePath, source } of await workspaceSources) {
      for (const match of source.matchAll(barrelImportPattern)) {
        if (/\b[A-Z]\w*Token\b/.test(match[1] ?? "")) {
          violations.push(relativePath);
        }
      }
    }

    const useCaseBarrel = await Bun.file(
      path.join(workspaceRoot, "packages/usecases/src/index.ts"),
    ).text();
    const repositoryBarrel = await Bun.file(
      path.join(workspaceRoot, "packages/repositories/src/index.ts"),
    ).text();

    expect(violations).toEqual([]);
    expect(useCaseBarrel).not.toMatch(/export .*tokens/);
    expect(repositoryBarrel).not.toMatch(/export .*tokens/);
  });

  test("runtime code never reconstructs tokens or casts resolved services", async () => {
    const legacyTokenFactory = ["Symbol", "for("].join(".");
    const violations = (await workspaceSources).flatMap(
      ({ relativePath, source }) => {
        const reasons: string[] = [];
        if (source.includes(legacyTokenFactory)) reasons.push("Symbol.for");
        if (/\.resolve\([^\r\n)]*\)\s+as\s+/.test(source)) {
          reasons.push("resolve cast");
        }
        if (/\.resolve\(\s*["']/.test(source)) reasons.push("string resolve");
        return reasons.map((reason) => `${relativePath}: ${reason}`);
      },
    );

    expect(violations).toEqual([]);
  });
});
