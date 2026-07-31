import type {
  AdoptedCert,
  ImportedSite,
  ProxyScanResult,
} from "@upstand/domain";
import type { CommandExecutor } from "@upstand/usecases";

export function parseTraefikConfig(yamlOrJsonContent: string): {
  sites: ImportedSite[];
  warnings: string[];
} {
  const sites: ImportedSite[] = [];
  const warnings: string[] = [];

  const hostRuleMatches = [...yamlOrJsonContent.matchAll(/Host\(`([^`]+)`\)/g)];
  const serviceMatches = [
    ...yamlOrJsonContent.matchAll(/url:\s*["']?(https?:\/\/[^\s"']+)["']?/g),
  ];

  if (hostRuleMatches.length > 0) {
    for (let i = 0; i < hostRuleMatches.length; i++) {
      const host = hostRuleMatches[i]?.[1] ?? "";
      const upstream = serviceMatches[i]?.[1] ?? "http://localhost:8080";
      if (host) {
        sites.push({
          serverNames: [host],
          ssl: yamlOrJsonContent.includes("tls:"),
          target: { kind: "proxy", url: upstream },
          routes: [{ path: "/", url: upstream }],
          source: "traefik-config",
        });
      }
    }
  } else {
    warnings.push("No Traefik Host() router rules found in dynamic config.");
  }

  return { sites, warnings };
}

export async function scanTraefikProxy(
  executor?: CommandExecutor,
): Promise<ProxyScanResult> {
  const warnings: string[] = [];
  let traefikContent = "";

  if (executor) {
    // 1. Inspect Docker labels for Traefik label-based routing
    const dockerRes = await executor.exec(
      "docker ps --format '{{.Names}}' | xargs -n1 docker inspect --format '{{json .Config.Labels}}' 2>/dev/null",
    );
    if (dockerRes.exitCode === 0 && dockerRes.stdout.trim()) {
      const sites: ImportedSite[] = [];
      const lines = dockerRes.stdout.trim().split("\n");
      for (const line of lines) {
        try {
          const labels: Record<string, string> = JSON.parse(line);
          for (const [key, value] of Object.entries(labels)) {
            if (
              key.includes("traefik.http.routers.") &&
              key.endsWith(".rule")
            ) {
              const hostMatch = value.match(/Host\(`([^`]+)`\)/);
              if (hostMatch?.[1]) {
                sites.push({
                  serverNames: [hostMatch[1]],
                  ssl: key.includes("tls"),
                  target: { kind: "proxy", url: "http://container:8080" },
                  source: "traefik-docker-labels",
                });
              }
            }
          }
        } catch {
          // Ignore invalid JSON label lines
        }
      }
      if (sites.length > 0) {
        return { proxy: "traefik", sites, warnings: [] };
      }
    }

    // 2. Read Traefik dynamic file config
    const fileRes = await executor.exec(
      "cat /etc/traefik/traefik.yml /etc/traefik/dynamic/*.yml 2>/dev/null",
    );
    if (fileRes.exitCode === 0 && fileRes.stdout.trim()) {
      traefikContent = fileRes.stdout;
    }
  }

  if (!traefikContent) {
    return {
      proxy: "traefik",
      sites: [],
      warnings: ["Traefik configuration files not found at /etc/traefik/"],
    };
  }

  const { sites, warnings: parseWarnings } = parseTraefikConfig(traefikContent);
  return {
    proxy: "traefik",
    sites,
    warnings: [...warnings, ...parseWarnings],
  };
}

export async function extractTraefikCertificates(
  executor?: CommandExecutor,
): Promise<AdoptedCert[]> {
  const certs: AdoptedCert[] = [];
  if (!executor) return certs;

  const acmeRes = await executor.exec(
    "cat /etc/traefik/acme.json /acme.json 2>/dev/null",
  );
  if (acmeRes.exitCode === 0 && acmeRes.stdout.trim()) {
    try {
      const parsed = JSON.parse(acmeRes.stdout);
      const resolver = parsed.letsencrypt || parsed.default || parsed;
      const certificates = resolver?.Certificates || [];
      for (const cert of certificates) {
        if (cert.domain?.main) {
          certs.push({
            domain: cert.domain.main,
            certPath: "/etc/traefik/acme.json",
            keyPath: "/etc/traefik/acme.json",
            certContent: cert.certificate,
            keyContent: cert.key,
            issuer: "traefik-acme",
          });
        }
      }
    } catch {
      // Ignore unparseable acme.json
    }
  }

  return certs;
}
