import { exec } from "node:child_process";
import { promisify } from "node:util";
import type {
  EdgeClassification,
  EdgeOccupant,
  EdgeStatus,
  ProxyKind,
} from "@upstand/domain";
import type { CommandExecutor, IProxyDetector } from "@upstand/usecases";

const execAsync = promisify(exec);

export function classifyProxyCommand(cmd: string): ProxyKind {
  const normalized = cmd.toLowerCase();
  if (normalized.includes("caddy")) return "caddy";
  if (normalized.includes("traefik")) return "traefik";
  if (normalized.includes("openresty")) return "openresty";
  if (normalized.includes("nginx")) return "nginx";
  if (normalized.includes("apache") || normalized.includes("httpd"))
    return "apache";
  if (normalized.includes("haproxy")) return "haproxy";
  return "unknown";
}

export class DefaultProxyDetector implements IProxyDetector {
  async probeEdge(
    executor?: CommandExecutor,
    _serverId?: string,
  ): Promise<EdgeStatus> {
    const runCmd = async (command: string) => {
      if (executor) {
        return executor.exec(command);
      }
      try {
        const res = await execAsync(command);
        return { stdout: res.stdout, stderr: res.stderr, exitCode: 0 };
      } catch (err) {
        return {
          stdout: "",
          stderr: err instanceof Error ? err.message : String(err),
          exitCode: 1,
        };
      }
    };

    const occupants: EdgeOccupant[] = [];
    const ports = [80, 443];

    for (const port of ports) {
      // 1. Check Docker containers binding port 80/443
      const dockerRes = await runCmd(
        `docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' --filter 'publish=${port}'`,
      );
      if (dockerRes.exitCode === 0 && dockerRes.stdout.trim()) {
        const lines = dockerRes.stdout.trim().split("\n");
        for (const line of lines) {
          const [containerName = "", image = ""] = line.split("\t");
          if (containerName) {
            const isOurs =
              containerName.includes("upstand") ||
              containerName.includes("openship");
            const proxy = classifyProxyCommand(`${containerName} ${image}`);
            occupants.push({
              port,
              containerName,
              command: `${image} (${containerName})`,
              isDocker: true,
              proxy: proxy !== "unknown" ? proxy : undefined,
              managedByUpstand: isOurs,
            });
          }
        }
      }

      // 2. If not detected via Docker, check system sockets / netstat / ss / lsof
      if (!occupants.some((o) => o.port === port)) {
        const ssRes = await runCmd(
          `ss -tulpn '( sport = :${port} )' 2>/dev/null || lsof -i:${port} 2>/dev/null`,
        );
        if (ssRes.exitCode === 0 && ssRes.stdout.trim()) {
          const raw = ssRes.stdout.trim();
          const proxy = classifyProxyCommand(raw);
          const isOurs = raw.includes("upstand") || raw.includes("openship");

          let systemdUnit: string | undefined;
          if (raw.includes("nginx")) systemdUnit = "nginx.service";
          else if (raw.includes("caddy")) systemdUnit = "caddy.service";
          else if (raw.includes("apache2") || raw.includes("httpd"))
            systemdUnit = "apache2.service";
          else if (raw.includes("traefik")) systemdUnit = "traefik.service";

          occupants.push({
            port,
            command: raw.split("\n")[0] ?? `port :${port}`,
            rawCommand: raw,
            systemdUnit,
            isDocker: false,
            proxy: proxy !== "unknown" ? proxy : undefined,
            managedByUpstand: isOurs,
          });
        }
      }
    }

    let classification: EdgeClassification = "free";
    if (occupants.length > 0) {
      const allOurs = occupants.every((o) => o.managedByUpstand);
      if (allOurs) {
        classification = "ours";
      } else {
        const hasKnown = occupants.some(
          (o) => o.proxy && o.proxy !== "unknown",
        );
        classification = hasKnown ? "known" : "unknown";
      }
    }

    const canProceedClean =
      classification === "free" || classification === "ours";

    return {
      classification,
      occupants,
      canProceedClean,
    };
  }
}
