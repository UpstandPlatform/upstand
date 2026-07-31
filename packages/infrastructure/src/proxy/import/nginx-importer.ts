import type {
  AdoptedCert,
  ImportedSite,
  ProxyScanResult,
} from "@upstand/domain";
import type { CommandExecutor } from "@upstand/usecases";

export function parseNginxConfig(content: string): {
  sites: ImportedSite[];
  warnings: string[];
} {
  const sites: ImportedSite[] = [];
  const warnings: string[] = [];

  const serverBlocks = content.split(/server\s*\{/);
  for (let i = 1; i < serverBlocks.length; i++) {
    const block = serverBlocks[i] ?? "";
    const serverNameMatch = block.match(/server_name\s+([^;]+);/);
    const listenMatch = block.match(/listen\s+([^;]+);/);
    const proxyPassMatches = [...block.matchAll(/proxy_pass\s+([^;]+);/g)];
    const rootMatch = block.match(/root\s+([^;]+);/);
    const sslCertMatch = block.match(/ssl_certificate\s+([^;]+);/);
    const sslKeyMatch = block.match(/ssl_certificate_key\s+([^;]+);/);

    if (!serverNameMatch?.[1]) continue;

    const serverNames = serverNameMatch[1]
      .trim()
      .split(/\s+/)
      .filter((name) => name && name !== "_");

    if (serverNames.length === 0) continue;

    const listenStr = listenMatch?.[1] ?? "";
    const isSsl =
      listenStr.includes("443") ||
      listenStr.includes("ssl") ||
      Boolean(sslCertMatch);

    let tlsInfo: { certPath: string; keyPath: string } | undefined;
    if (sslCertMatch && sslKeyMatch && sslCertMatch[1] && sslKeyMatch[1]) {
      tlsInfo = {
        certPath: sslCertMatch[1].trim(),
        keyPath: sslKeyMatch[1].trim(),
      };
    }

    if (proxyPassMatches.length > 0) {
      const routes = proxyPassMatches.map((m) => ({
        path: "/",
        url: (m[1] ?? "http://localhost:8080").trim(),
      }));
      const primaryUrl = routes[0]?.url ?? "http://localhost:8080";

      sites.push({
        serverNames,
        ssl: isSsl,
        target: { kind: "proxy", url: primaryUrl },
        routes,
        tls: tlsInfo,
        source: "nginx-config",
      });
    } else if (rootMatch?.[1]) {
      sites.push({
        serverNames,
        ssl: isSsl,
        target: { kind: "static", root: rootMatch[1].trim() },
        tls: tlsInfo,
        source: "nginx-config",
      });
    } else {
      warnings.push(
        `Nginx server block '${serverNames.join(", ")}' has no proxy_pass or root directive.`,
      );
    }
  }

  return { sites, warnings };
}

export async function scanNginxProxy(
  executor?: CommandExecutor,
): Promise<ProxyScanResult> {
  const warnings: string[] = [];
  let nginxContent = "";

  if (executor) {
    const res = await executor.exec(
      "cat /etc/nginx/nginx.conf /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/* 2>/dev/null",
    );
    if (res.exitCode === 0 && res.stdout.trim()) {
      nginxContent = res.stdout;
    }
  }

  if (!nginxContent) {
    return {
      proxy: "nginx",
      sites: [],
      warnings: ["Nginx configuration files not found at /etc/nginx/"],
    };
  }

  const { sites, warnings: parseWarnings } = parseNginxConfig(nginxContent);
  return {
    proxy: "nginx",
    sites,
    warnings: [...warnings, ...parseWarnings],
  };
}

export async function extractNginxCertificates(
  executor?: CommandExecutor,
): Promise<AdoptedCert[]> {
  const certs: AdoptedCert[] = [];
  if (!executor) return certs;

  const findRes = await executor.exec(
    "find /etc/letsencrypt/live /etc/nginx/ssl -name 'fullchain.pem' -o -name '*.crt' 2>/dev/null",
  );
  if (findRes.exitCode === 0 && findRes.stdout.trim()) {
    const files = findRes.stdout.trim().split("\n");
    for (const certPath of files) {
      const keyPath = certPath.includes("fullchain.pem")
        ? certPath.replace("fullchain.pem", "privkey.pem")
        : certPath.replace(/\.crt$/, ".key");
      const domain = certPath.split("/").slice(-2)[0] ?? "unknown";
      certs.push({
        domain,
        certPath,
        keyPath,
        issuer: "nginx-certbot",
      });
    }
  }

  return certs;
}
