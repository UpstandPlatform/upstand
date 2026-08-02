const composeFile = "docker-compose.local.yml";

function run(command: string, args: string[]): void {
  const result = Bun.spawnSync({
    cmd: [command, ...args],
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!result.success) {
    throw new Error(`${command} exited with code ${result.exitCode}`);
  }
}

console.log(
  "Stopping Upstand local containers (named volumes are preserved)...",
);
run("docker", ["compose", "-f", composeFile, "down", "--remove-orphans"]);

console.log("Removing stopped Upstand platform containers...");
run("docker", [
  "container",
  "prune",
  "--force",
  "--filter",
  "label=com.upstand.platform=true",
]);

console.log(
  "Removing dangling Docker images and build cache older than 24 hours...",
);
run("docker", ["image", "prune", "--force"]);
run("docker", ["builder", "prune", "--force", "--filter", "until=24h"]);

console.log(
  "Docker cleanup complete. The external Upstand overlay network and named data volumes were kept.",
);

export {};
