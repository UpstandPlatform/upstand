import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const serverDirectory = path.join(root, "apps", "server");
const webDirectory = path.join(root, "apps", "web");
const fumadocsDirectory = path.join(root, "apps", "fumadocs");
const requiredBunVersion = "1.3.14";
const composeFile = path.join(root, "docker-compose.local.yml");
type LocalMode = "cloud" | "self-hosted";

const modeProfiles: Record<
  LocalMode,
  {
    isCloud: "true" | "false";
    composeProject: string;
    dockerNetwork: string;
    postgresVolume: string;
    redisVolume: string;
    webCacheVolume: string;
    fumadocsCacheVolume: string;
  }
> = {
  "self-hosted": {
    isCloud: "false",
    composeProject: "upstand-local-self-hosted",
    dockerNetwork: "upstand-network",
    postgresVolume: "upstand-postgres-data-v18-self-hosted",
    redisVolume: "upstand-redis-data-self-hosted",
    webCacheVolume: "upstand-web-next-cache-self-hosted",
    fumadocsCacheVolume: "upstand-fumadocs-next-cache-self-hosted",
  },
  cloud: {
    isCloud: "true",
    composeProject: "upstand-local-cloud",
    dockerNetwork: "upstand-network",
    postgresVolume: "upstand-postgres-data-v18-cloud",
    redisVolume: "upstand-redis-data-cloud",
    webCacheVolume: "upstand-web-next-cache-cloud",
    fumadocsCacheVolume: "upstand-fumadocs-next-cache-cloud",
  },
};

function fail(message: string): never {
  console.error(`\nSetup failed: ${message}`);
  process.exit(1);
}

function run(command: string, args: string[], env = process.env): void {
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync({
      cmd: [command, ...args],
      cwd: root,
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
  } catch {
    fail(
      `Could not run '${command}'. Make sure it is installed and available on PATH.`,
    );
  }

  if (!result.success) {
    fail(`'${command}' exited with code ${result.exitCode}.`);
  }
}

function commandWorks(command: string, args: string[]): boolean {
  try {
    return Bun.spawnSync({
      cmd: [command, ...args],
      cwd: root,
      stdout: "ignore",
      stderr: "ignore",
    }).success;
  } catch {
    return false;
  }
}

function getLocalModeOverride(): "true" | "false" | undefined {
  const cloud = process.argv.includes("--cloud");
  const selfHosted = process.argv.includes("--self-hosted");
  if (cloud && selfHosted) {
    fail("Choose only one local mode: --cloud or --self-hosted.");
  }
  if (cloud) return "true";
  if (selfHosted) return "false";
  return undefined;
}

function ensureLocalSwarmNetwork(env: NodeJS.ProcessEnv, networkName: string) {
  const swarmState = Bun.spawnSync({
    cmd: ["docker", "info", "--format", "{{.Swarm.LocalNodeState}}"],
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "ignore",
  });
  if (swarmState.success && swarmState.stdout.toString().trim() !== "active") {
    run("docker", ["swarm", "init"], env);
  }

  const network = Bun.spawnSync({
    cmd: [
      "docker",
      "network",
      "inspect",
      "--format",
      "{{.Driver}} {{.Attachable}} {{json .Options}}",
      networkName,
    ],
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "ignore",
  });
  if (network.success) {
    const [driver, attachable] = network.stdout.toString().trim().split(/\s+/);
    if (driver === "overlay" && attachable === "true") {
      return;
    }
    fail(
      `Docker network '${networkName}' already exists but is not an attachable overlay network. Recreate it with '--driver overlay --attachable' (after stopping services) or choose another network name before starting local parity mode.`,
    );
  }

  run(
    "docker",
    [
      "network",
      "create",
      "--driver",
      "overlay",
      "--opt",
      "encrypted",
      "--attachable",
      networkName,
    ],
    env,
  );
}

async function copyIfMissing(
  examplePath: string,
  targetPath: string,
): Promise<boolean> {
  if (await Bun.file(targetPath).exists()) {
    return false;
  }

  if (!(await Bun.file(examplePath).exists())) {
    fail(`Missing environment template: ${path.relative(root, examplePath)}`);
  }

  await Bun.write(targetPath, Bun.file(examplePath));
  console.log(`Created ${path.relative(root, targetPath)}`);
  return true;
}

function readEnvValue(contents: string, name: string): string | undefined {
  return contents
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function databasePassword(databaseUrl: string | undefined): string | undefined {
  if (!databaseUrl) {
    return undefined;
  }

  try {
    return decodeURIComponent(new URL(databaseUrl).password);
  } catch {
    return undefined;
  }
}

function databaseUrlWithPassword(
  databaseUrl: string | undefined,
  password: string | undefined,
): string | undefined {
  if (!databaseUrl || !password) {
    return undefined;
  }

  try {
    const url = new URL(databaseUrl);
    url.password = password;
    return url.toString();
  } catch {
    return undefined;
  }
}

function replaceEnvValue(
  contents: string,
  name: string,
  value: string,
): string {
  const lines = contents.split(/\r?\n/);
  const lineIndex = lines.findIndex((line) => line.startsWith(`${name}=`));
  if (lineIndex === -1) {
    lines.push(`${name}=${value}`);
  } else {
    lines[lineIndex] = `${name}=${value}`;
  }
  return lines.join("\n");
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function waitForPostgres(
  env: NodeJS.ProcessEnv,
  composeProject: string,
): Promise<void> {
  const attempts = 30;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = Bun.spawnSync({
        cmd: [
          "docker",
          "compose",
          "--project-name",
          composeProject,
          "-f",
          composeFile,
          "exec",
          "-T",
          "postgres",
          "pg_isready",
          "-U",
          "postgres",
          "-d",
          "upstand",
        ],
        cwd: root,
        env,
        stdout: "ignore",
        stderr: "ignore",
      });
      if (result.success) {
        return;
      }
    } catch {
      // Docker may still be starting the container.
    }

    await Bun.sleep(1000);
  }

  fail(
    "PostgreSQL did not become ready within 30 seconds. Run `bun run docker:logs` to inspect it.",
  );
}

async function main(): Promise<void> {
  console.log("🔍 Checking development environment requirements...");

  if (Bun.version !== requiredBunVersion) {
    fail(
      `This repository requires Bun ${requiredBunVersion}; found Bun ${Bun.version}.`,
    );
  }
  console.log(`✔ Bun ${Bun.version} verified`);

  if (!commandWorks("docker", ["info"])) {
    fail(
      "Docker Engine is not available. Install Docker Desktop or Docker Engine, start it, and run `bun dev` again.",
    );
  }
  console.log("✔ Docker Engine active");

  const rootEnvCreated = await copyIfMissing(
    path.join(root, ".env.example"),
    path.join(root, ".env"),
  );
  const serverEnvCreated = await copyIfMissing(
    path.join(serverDirectory, ".env.example"),
    path.join(serverDirectory, ".env"),
  );
  await copyIfMissing(
    path.join(webDirectory, ".env.example"),
    path.join(webDirectory, ".env.local"),
  );
  await copyIfMissing(
    path.join(fumadocsDirectory, ".env.example"),
    path.join(fumadocsDirectory, ".env.local"),
  );
  console.log("✔ Environment configurations verified (.env, .env.local)");

  if (!process.argv.includes("--skip-install")) {
    console.log("📦 Installing workspace dependencies...");
    run(process.execPath, ["install", "--frozen-lockfile"]);
    console.log("✔ Dependencies installed");
  }

  const env = { ...process.env };
  let rootEnv = await Bun.file(path.join(root, ".env")).text();
  const serverEnvPath = path.join(serverDirectory, ".env");
  let serverEnv = await Bun.file(serverEnvPath).text();
  const modeOverride = getLocalModeOverride();
  const currentMode: LocalMode = modeOverride
    ? modeOverride === "true"
      ? "cloud"
      : "self-hosted"
    : readEnvValue(rootEnv, "IS_CLOUD") === "true"
      ? "cloud"
      : "self-hosted";
  const profile = modeProfiles[currentMode];
  env.IS_CLOUD = profile.isCloud;
  env.COMPOSE_PROJECT_NAME = profile.composeProject;
  env.DOCKER_NETWORK = profile.dockerNetwork;
  env.UPSTAND_POSTGRES_VOLUME = profile.postgresVolume;
  env.UPSTAND_REDIS_VOLUME = profile.redisVolume;
  env.UPSTAND_WEB_CACHE_VOLUME = profile.webCacheVolume;
  env.UPSTAND_FUMADOCS_CACHE_VOLUME = profile.fumadocsCacheVolume;
  rootEnv = replaceEnvValue(rootEnv, "IS_CLOUD", profile.isCloud);
  rootEnv = replaceEnvValue(
    rootEnv,
    "COMPOSE_PROJECT_NAME",
    profile.composeProject,
  );
  rootEnv = replaceEnvValue(rootEnv, "DOCKER_NETWORK", profile.dockerNetwork);
  rootEnv = replaceEnvValue(
    rootEnv,
    "UPSTAND_POSTGRES_VOLUME",
    profile.postgresVolume,
  );
  rootEnv = replaceEnvValue(
    rootEnv,
    "UPSTAND_REDIS_VOLUME",
    profile.redisVolume,
  );
  rootEnv = replaceEnvValue(
    rootEnv,
    "UPSTAND_WEB_CACHE_VOLUME",
    profile.webCacheVolume,
  );
  rootEnv = replaceEnvValue(
    rootEnv,
    "UPSTAND_FUMADOCS_CACHE_VOLUME",
    profile.fumadocsCacheVolume,
  );
  serverEnv = replaceEnvValue(serverEnv, "IS_CLOUD", profile.isCloud);
  serverEnv = replaceEnvValue(
    serverEnv,
    "DOCKER_NETWORK",
    profile.dockerNetwork,
  );
  await Promise.all([
    Bun.write(path.join(root, ".env"), rootEnv),
    Bun.write(serverEnvPath, serverEnv),
  ]);
  console.log(
    `✔ Local deployment mode set to ${currentMode} (${profile.composeProject})`,
  );
  const localNetworkName = profile.dockerNetwork;
  console.log(
    `🌐 Ensuring local Docker Swarm network '${localNetworkName}'...`,
  );
  ensureLocalSwarmNetwork(env, localNetworkName);
  console.log("✔ Local Swarm network ready");
  const configuredPassword = readEnvValue(rootEnv, "POSTGRES_PASSWORD");
  const serverDatabaseUrl = readEnvValue(serverEnv, "DATABASE_URL");
  const serverPassword = databasePassword(serverDatabaseUrl);
  const postgresPassword =
    rootEnvCreated && !serverEnvCreated
      ? (serverPassword ?? configuredPassword)
      : (configuredPassword ?? serverPassword);
  if (postgresPassword) {
    env.POSTGRES_PASSWORD = postgresPassword;
  }

  const migrationDatabaseUrl = databaseUrlWithPassword(
    serverDatabaseUrl,
    postgresPassword,
  );
  if (migrationDatabaseUrl) {
    env.DATABASE_URL = migrationDatabaseUrl;
    if (serverPassword !== postgresPassword) {
      await Bun.write(
        serverEnvPath,
        replaceEnvValue(serverEnv, "DATABASE_URL", migrationDatabaseUrl),
      );
      console.log("✔ Synchronized application database credentials");
    }
  }

  console.log("🐘 Ensuring local PostgreSQL and Redis services are active...");
  // Stop full application containers if running in Docker so host ports (3000, 3001, 3002, 4000) are freed
  for (const project of ["upstand-local-self-hosted", "upstand-local-cloud"]) {
    run(
      "docker",
      [
        "compose",
        "--project-name",
        project,
        "-f",
        composeFile,
        "stop",
        "server",
        "web",
        "schedules",
        "fumadocs",
        "postgres",
        "redis",
      ],
      { ...env, COMPOSE_PROJECT_NAME: project },
    );
  }
  run(
    "docker",
    [
      "compose",
      "--project-name",
      profile.composeProject,
      "-f",
      composeFile,
      "up",
      "-d",
      "postgres",
      "redis",
    ],
    env,
  );
  await waitForPostgres(env, profile.composeProject);
  console.log("✔ PostgreSQL & Redis services ready");

  if (postgresPassword) {
    run(
      "docker",
      [
        "compose",
        "--project-name",
        profile.composeProject,
        "-f",
        composeFile,
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-c",
        `ALTER ROLE postgres PASSWORD ${sqlString(postgresPassword)};`,
      ],
      env,
    );
  }

  console.log("🔄 Applying database migrations...");
  run(process.execPath, ["run", "db:migrate"], env);
  console.log("✔ Database migrations up to date\n");
}

await main();
