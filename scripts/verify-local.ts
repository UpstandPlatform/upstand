const composeFile = "docker-compose.local.yml";

import { env } from "@upstand/env/testing";

const networkName = env.DOCKER_NETWORK;
const apiBaseUrl = env.LOCAL_API_URL;
const webBaseUrl = env.LOCAL_WEB_URL;
const docsBaseUrl = env.LOCAL_DOCS_URL;
const timeoutMs = env.LOCAL_VERIFY_TIMEOUT_MS;
const expectedMode = env.LOCAL_EXPECTED_MODE;
const runtime = env.LOCAL_RUNTIME;

function fail(message: string): never {
  console.error(`\nLocal parity verification failed: ${message}`);
  process.exit(1);
}

function commandOutput(args: string[]) {
  const result = Bun.spawnSync({
    cmd: ["docker", ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    success: result.success,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

async function waitForEndpoint(
  name: string,
  url: string,
  validate: (response: Response) => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      });
      if (await validate(response)) {
        console.log(`✔ ${name}: ${url}`);
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(1000);
  }

  fail(`${name} did not become ready (${lastError}).`);
}

async function jsonStatus(response: Response, expected: string) {
  if (!response.ok) return false;
  const body = (await response.json()) as { status?: string };
  return body.status === expected;
}

async function verifyMode(): Promise<void> {
  if (expectedMode !== "cloud" && expectedMode !== "self-hosted") return;
  const response = await fetch(`${apiBaseUrl}/api/setup/status`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok)
    fail(`Deployment mode endpoint returned HTTP ${response.status}.`);
  const body = (await response.json()) as { isCloud?: unknown };
  const actualMode = body.isCloud === true ? "cloud" : "self-hosted";
  if (actualMode !== expectedMode) {
    fail(`Expected ${expectedMode} mode but API reports ${actualMode}.`);
  }
  console.log(`✔ Deployment mode: ${actualMode}`);
}

if (runtime === "compose") {
  const network = commandOutput([
    "network",
    "inspect",
    "--format",
    "{{.Driver}} {{.Attachable}}",
    networkName,
  ]);
  const [networkDriver, networkAttachable] = network.stdout
    .split(/\s+/)
    .filter(Boolean);
  if (
    !network.success ||
    networkDriver !== "overlay" ||
    networkAttachable !== "true"
  ) {
    fail(
      `network '${networkName}' must be an attachable overlay network. Stop services, recreate it with '--driver overlay --attachable', then run 'bun dev' or 'bun run setup' again.`,
    );
  }
  console.log(`✔ Docker network: ${networkName} (${network.stdout})`);

  const runningServices = commandOutput([
    "compose",
    "-f",
    composeFile,
    "ps",
    "--status",
    "running",
    "--services",
  ]);
  const expectedServices = [
    "fumadocs",
    "postgres",
    "redis",
    "schedules",
    "server",
    "web",
  ];
  const actualServices = runningServices.stdout
    .split(/\r?\n/)
    .map((service) => service.trim())
    .filter(Boolean);
  const missingServices = expectedServices.filter(
    (service) => !actualServices.includes(service),
  );
  if (!runningServices.success || missingServices.length > 0) {
    fail(
      `expected local Compose services are not all running. Missing: ${missingServices.join(", ") || "unknown"}. Run 'bun run docker:local:up' and inspect 'bun run docker:logs'.`,
    );
  }
  console.log(`✔ Compose services running: ${expectedServices.join(", ")}`);
} else if (runtime === "host") {
  console.log("✔ Host-process development runtime selected");
} else {
  fail(`Unsupported LOCAL_RUNTIME '${runtime}'. Use 'compose' or 'host'.`);
}

await waitForEndpoint(
  "API liveness",
  `${apiBaseUrl}/health/live`,
  async (response) => jsonStatus(response, "alive"),
);
await waitForEndpoint(
  "API readiness",
  `${apiBaseUrl}/health/ready`,
  async (response) => jsonStatus(response, "ready"),
);
await verifyMode();
await waitForEndpoint(
  "Dashboard",
  `${webBaseUrl}/dashboard`,
  async (response) => response.status >= 200 && response.status < 400,
);
await waitForEndpoint(
  "Documentation site",
  `${docsBaseUrl}/health`,
  async (response) => response.ok,
);
console.log("\nLocal parity verification passed.");
