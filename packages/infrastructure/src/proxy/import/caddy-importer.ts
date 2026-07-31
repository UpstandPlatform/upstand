import type {
  AdoptedCert,
  ImportedSite,
  ProxyScanResult,
} from "@upstand/domain";
import type { CommandExecutor } from "@upstand/usecases";

export function parseCaddyfile(content: string): {
  sites: ImportedSite[];
  warnings: string[];
} {
  const sites: ImportedSite[] = [];
  const warnings: string[] = [];

  const blocks = content.split(/\n(?=[a-zA-Z0-9*._-]+\s*\{)/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const headerMatch = trimmed.match(/^([^{\n]+)\{/);
    if (!headerMatch) continue;

    const header = headerMatch[1]?.trim() ?? "";
    const rawNames = header
      .split(/[\s,]+/)
      .map((name) => name.trim())
      .filter((name) => name && !name.startsWith("#"));

    if (rawNames.length === 0) continue;

    const serverNames: string[] = [];
    let isSsl = false;

    for (const name of rawNames) {
      if (name.startsWith("http://")) {
        serverNames.push(name.replace(/^http:\/\//, ""));
      } else if (name.startsWith("https://")) {
        serverNames.push(name.replace(/^https:\/\//, ""));
        isSsl = true;
      } else if (name.includes(":443")) {
        serverNames.push(name.replace(/:443$/, ""));
        isSsl = true;
      } else if (name.includes(":80")) {
        serverNames.push(name.replace(/:80$/, ""));
      } else {
        serverNames.push(name);
        if (!name.includes("localhost") && !name.includes("127.0.0.1")) {
          isSsl = true;
        }
      }
    }

    const proxyMatches = [...trimmed.matchAll(/reverse_proxy\s+([^\s\n{]+)/g)];
    const rootMatch = trimmed.match(/root\s+\*\s+([^\s\n]+)/);
    const tlsCertMatch = trimmed.match(/tls\s+([^\s\n]+)\s+([^\s\n]+)/);

    let tlsInfo: { certPath: string; keyPath: string } | undefined;
    if (tlsCertMatch?.[1] && tlsCertMatch[2]) {
      tlsInfo = { certPath: tlsCertMatch[1], keyPath: tlsCertMatch[2] };
    }

    if (proxyMatches.length > 0) {
      const routes = proxyMatches.map((m) => {
        let upstream = m[1] ?? "";
        if (
          !upstream.startsWith("http://") &&
          !upstream.startsWith("https://")
        ) {
          upstream = `http://${upstream}`;
        }
        return { path: "/", url: upstream };
      });
      const primaryUrl = routes[0]?.url ?? "http://localhost:8080";

      sites.push({
        serverNames,
        ssl: isSsl,
        target: { kind: "proxy", url: primaryUrl },
        routes,
        tls: tlsInfo,
        source: "Caddyfile",
      });
    } else if (rootMatch?.[1]) {
      sites.push({
        serverNames,
        ssl: isSsl,
        target: { kind: "static", root: rootMatch[1] },
        tls: tlsInfo,
        source: "Caddyfile",
      });
    } else {
      warnings.push(
        `Caddyfile block '${header}' has no recognized reverse_proxy or root target.`,
      );
    }
  }

  return { sites, warnings };
}

export async function scanCaddyProxy(
  executor?: CommandExecutor,
): Promise<ProxyScanResult> {
  const warnings: string[] = [];
  let caddyfileContent = "";

  if (executor) {
    const res = await executor.exec(
      "cat /etc/caddy/Caddyfile 2>/dev/null || docker exec caddy cat /etc/caddy/Caddyfile 2>/dev/null",
    );
    if (res.exitCode === 0 && res.stdout.trim()) {
      caddyfileContent = res.stdout;
    }
  }

  if (!caddyfileContent) {
    return {
      proxy: "caddy",
      sites: [],
      warnings: [
        "Caddyfile configuration file not found at /etc/caddy/Caddyfile",
      ],
    };
  }

  const { sites, warnings: parseWarnings } = parseCaddyfile(caddyfileContent);
  return {
    proxy: "caddy",
    sites,
    warnings: [...warnings, ...parseWarnings],
  };
}

export async function extractCaddyCertificates(
  executor?: CommandExecutor,
): Promise<AdoptedCert[]> {
  const certs: AdoptedCert[] = [];
  if (!executor) return certs;

  const findRes = await executor.exec(
    "find /data/caddy/certificates /etc/caddy/certificates -name '*.crt' -o -name '*.pem' 2>/dev/null",
  );
  if (findRes.exitCode === 0 && findRes.stdout.trim()) {
    const files = findRes.stdout.trim().split("\n");
    for (const certPath of files) {
      const keyPath = certPath.replace(/\.(crt|pem)$/, ".key");
      const domain =
        certPath
          .split("/")
          .pop()
          ?.replace(/\.(crt|pem)$/, "") ?? "unknown";
      certs.push({
        domain,
        certPath,
        keyPath,
        issuer: "caddy-acme",
      });
    }
  }
  return certs;
}
