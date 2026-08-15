import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const labDirectory = path.join(root, ".upstand", "remote-lab");
const statePath = path.join(labDirectory, "state.json");
const privateKeyPath = path.join(labDirectory, "id_ed25519");

const profiles = {
  deploy: { cpus: "2", memory: "4G", disk: "20G" },
  database: { cpus: "2", memory: "3G", disk: "16G" },
  build: { cpus: "2", memory: "3G", disk: "16G" },
} as const;

type Profile = keyof typeof profiles;
type LabState = { profiles: Profile[]; privateKeyPath: string };

function fail(message: string): never {
  console.error(`\nRemote lab failed: ${message}`);
  process.exit(1);
}

function run(args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ["multipass", ...args],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = result.stdout.toString().trim();
  if (!result.success) {
    const stderr = result.stderr.toString().trim();
    fail(stderr || `multipass ${args.join(" ")} failed.`);
  }
  return stdout;
}

function tryRun(args: string[]): string | undefined {
  const result = Bun.spawnSync({
    cmd: ["multipass", ...args],
    cwd: root,
    stdout: "pipe",
    stderr: "ignore",
  });
  return result.success ? result.stdout.toString().trim() : undefined;
}

function ensureMultipass(): void {
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync({
      cmd: ["multipass", "version"],
      cwd: root,
      stdout: "ignore",
      stderr: "ignore",
    });
  } catch {
    fail(
      "Multipass is required. Install Multipass with Hyper-V support, then rerun this command.",
    );
  }
  if (!result.success) {
    fail(
      "Multipass is required. Install Multipass with Hyper-V support, then rerun this command.",
    );
  }
}

function selectedProfiles(arguments_: string[]): Profile[] {
  const index = arguments_.indexOf("--profile");
  if (index === -1) return ["deploy"];

  const value = arguments_[index + 1];
  if (!value) fail("--profile requires deploy, database, or build.");
  const selected = value
    .split(",")
    .map((profile) => profile.trim()) as Profile[];
  if (
    selected.length === 0 ||
    selected.some((profile) => !Object.hasOwn(profiles, profile))
  ) {
    fail("--profile accepts deploy, database, and build.");
  }
  return [...new Set(selected)];
}

function instanceName(profile: Profile): string {
  return `upstand-remote-${profile}`;
}

function ensureKey(): string {
  fs.mkdirSync(labDirectory, { recursive: true });
  if (!fs.existsSync(privateKeyPath)) {
    let result: ReturnType<typeof Bun.spawnSync>;
    try {
      result = Bun.spawnSync({
        cmd: [
          "ssh-keygen",
          "-t",
          "ed25519",
          "-N",
          "",
          "-C",
          "upstand-remote-lab",
          "-f",
          privateKeyPath,
        ],
        cwd: root,
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
      });
    } catch {
      fail("OpenSSH ssh-keygen is required to create the lab SSH key.");
    }
    if (!result.success) fail("ssh-keygen could not create the lab SSH key.");
  }
  return fs.readFileSync(`${privateKeyPath}.pub`, "utf8").trim();
}

function instanceInfo(
  name: string,
): { state: string; ip?: string } | undefined {
  const output = tryRun(["info", "--format", "json", name]);
  if (!output) return undefined;
  try {
    const info = JSON.parse(output) as {
      info?: Record<string, { state?: string; ipv4?: string[] }>;
    };
    const instance = info.info?.[name];
    if (!instance) return undefined;
    return {
      state: instance.state ?? "UNKNOWN",
      ip: instance.ipv4?.find((address) => address && address !== "N/A"),
    };
  } catch {
    fail(`Could not parse Multipass information for ${name}.`);
  }
}

function configureSsh(name: string, publicKey: string): void {
  const encodedKey = Buffer.from(publicKey, "utf8").toString("base64");
  const script = [
    "set -eu",
    "sudo apt-get update",
    "sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl openssh-server",
    "sudo mkdir -p /root/.ssh",
    `decoded_key="$(printf '%s' '${encodedKey}' | base64 --decode)"`,
    "sudo touch /root/.ssh/authorized_keys",
    'sudo grep -qxF "$decoded_key" /root/.ssh/authorized_keys || printf \'%s\\n\' "$decoded_key" | sudo tee -a /root/.ssh/authorized_keys >/dev/null',
    "sudo chmod 700 /root/.ssh",
    "sudo chmod 600 /root/.ssh/authorized_keys",
    "printf '%s\\n' 'PermitRootLogin prohibit-password' 'PubkeyAuthentication yes' 'PasswordAuthentication no' | sudo tee /etc/ssh/sshd_config.d/upstand-remote-lab.conf >/dev/null",
    "sudo systemctl enable --now ssh",
    "sudo systemctl restart ssh",
  ].join(" && ");
  run(["exec", name, "--", "bash", "-lc", script]);
}

function writeState(selected: Profile[]): void {
  fs.mkdirSync(labDirectory, { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      { profiles: selected, privateKeyPath } satisfies LabState,
      null,
      2,
    ),
  );
}

function readState(): LabState {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8")) as LabState;
  } catch {
    return { profiles: [], privateKeyPath };
  }
}

function printConnectionDetails(
  selected: Profile[],
  publicKeyPath: string,
): void {
  console.log("\nRemote lab is ready for Upstand onboarding:");
  console.log(`SSH private key: ${privateKeyPath}`);
  console.log(`SSH public key:  ${publicKeyPath}`);
  for (const profile of selected) {
    const info = instanceInfo(instanceName(profile));
    console.log(
      `- ${profile}: ${info?.ip ?? "no IP"}  username=root  port=22  server type=${profile}`,
    );
  }
  console.log(
    "Add the public/private key in the dashboard, scan each host key, and run server setup. The VMs intentionally start without Docker so Upstand provisioning is exercised.",
  );
}

function up(selected: Profile[]): void {
  ensureMultipass();
  const publicKey = ensureKey();
  for (const profile of selected) {
    const name = instanceName(profile);
    const existing = instanceInfo(name);
    if (!existing) {
      const spec = profiles[profile];
      console.log(`Launching ${name}...`);
      run([
        "launch",
        "24.04",
        "--name",
        name,
        "--cpus",
        spec.cpus,
        "--memory",
        spec.memory,
        "--disk",
        spec.disk,
      ]);
    } else if (existing.state !== "RUNNING") {
      console.log(`Starting ${name}...`);
      run(["start", name]);
    }
    console.log(`Preparing SSH access for ${name}...`);
    configureSsh(name, publicKey);
  }
  const trackedProfiles = [
    ...new Set([...readState().profiles, ...selected]),
  ] as Profile[];
  writeState(trackedProfiles);
  printConnectionDetails(selected, `${privateKeyPath}.pub`);
}

function status(): void {
  ensureMultipass();
  const state = readState();
  if (state.profiles.length === 0) {
    console.log("No remote lab profiles are tracked.");
    return;
  }
  for (const profile of state.profiles) {
    const name = instanceName(profile);
    const info = instanceInfo(name);
    console.log(
      `${profile}: ${info?.state ?? "NOT_CREATED"}${info?.ip ? ` (${info.ip})` : ""}`,
    );
  }
}

function down(selected: Profile[]): void {
  ensureMultipass();
  for (const profile of selected) {
    const name = instanceName(profile);
    if (instanceInfo(name)) {
      console.log(`Stopping ${name}...`);
      run(["stop", name]);
    }
  }
}

function reset(selected: Profile[]): void {
  ensureMultipass();
  for (const profile of selected) {
    const name = instanceName(profile);
    if (instanceInfo(name)) {
      console.log(`Deleting ${name}...`);
      run(["delete", "--purge", name]);
    }
  }
  fs.rmSync(statePath, { force: true });
  console.log(
    "Remote lab VMs deleted. The local SSH key was preserved for reuse.",
  );
}

const [action = "up", ...arguments_] = process.argv.slice(2);
const profilesForAction: Profile[] = arguments_.includes("--profile")
  ? selectedProfiles(arguments_)
  : action === "reset"
    ? ["deploy", "database", "build"]
    : action === "down" || action === "status"
      ? readState().profiles
      : ["deploy"];

switch (action) {
  case "up":
    up(profilesForAction);
    break;
  case "status":
    status();
    break;
  case "down":
    down(profilesForAction);
    break;
  case "reset":
    reset(profilesForAction);
    break;
  default:
    fail(`Unknown action '${action}'. Use up, status, down, or reset.`);
}
