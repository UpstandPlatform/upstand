import type { ImportedSite, ProxyScanResult } from "@upstand/domain";
import type { CommandExecutor } from "@upstand/usecases";

export function parseApacheConfig(content: string): {
  sites: ImportedSite[];
  warnings: string[];
} {
  const sites: ImportedSite[] = [];
  const warnings: string[] = [];

  const vhostBlocks = content.split(/<VirtualHost[^>]*>/i);
  for (let i = 1; i < vhostBlocks.length; i++) {
    const block = (vhostBlocks[i] ?? "").split(/<\/VirtualHost>/i)[0] ?? "";

    const serverNameMatch = block.match(/ServerName\s+([^\s\n]+)/i);
    const serverAliasMatches = [...block.matchAll(/ServerAlias\s+([^\n]+)/gi)];
    const proxyPassMatches = [
      ...block.matchAll(/ProxyPass\s+\/\s+([^\s\n]+)/gi),
    ];
    const docRootMatch = block.match(/DocumentRoot\s+["']?([^"'\s\n]+)["']?/i);
    const sslCertMatch = block.match(/SSLCertificateFile\s+([^\s\n]+)/i);
    const sslKeyMatch = block.match(/SSLCertificateKeyFile\s+([^\s\n]+)/i);

    if (!serverNameMatch?.[1]) continue;

    const serverNames: string[] = [serverNameMatch[1].trim()];
    for (const match of serverAliasMatches) {
      if (match[1]) {
        serverNames.push(...match[1].trim().split(/\s+/));
      }
    }

    const isSsl = Boolean(sslCertMatch) || block.includes("SSLEngine on");

    let tlsInfo: { certPath: string; keyPath: string } | undefined;
    if (sslCertMatch && sslKeyMatch && sslCertMatch[1] && sslKeyMatch[1]) {
      tlsInfo = {
        certPath: sslCertMatch[1].trim(),
        keyPath: sslKeyMatch[1].trim(),
      };
    }

    if (proxyPassMatches.length > 0) {
      const primaryUrl =
        proxyPassMatches[0]?.[1]?.trim() ?? "http://localhost:8080";
      sites.push({
        serverNames,
        ssl: isSsl,
        target: { kind: "proxy", url: primaryUrl },
        routes: [{ path: "/", url: primaryUrl }],
        tls: tlsInfo,
        source: "apache-config",
      });
    } else if (docRootMatch?.[1]) {
      sites.push({
        serverNames,
        ssl: isSsl,
        target: { kind: "static", root: docRootMatch[1].trim() },
        tls: tlsInfo,
        source: "apache-config",
      });
    } else {
      warnings.push(
        `Apache VirtualHost '${serverNames.join(", ")}' has no ProxyPass or DocumentRoot.`,
      );
    }
  }

  return { sites, warnings };
}

export async function scanApacheProxy(
  executor?: CommandExecutor,
): Promise<ProxyScanResult> {
  const warnings: string[] = [];
  let apacheContent = "";

  if (executor) {
    const res = await executor.exec(
      "cat /etc/apache2/sites-enabled/* /etc/httpd/conf.d/*.conf 2>/dev/null",
    );
    if (res.exitCode === 0 && res.stdout.trim()) {
      apacheContent = res.stdout;
    }
  }

  if (!apacheContent) {
    return {
      proxy: "apache",
      sites: [],
      warnings: [
        "Apache configuration files not found at /etc/apache2/ or /etc/httpd/",
      ],
    };
  }

  const { sites, warnings: parseWarnings } = parseApacheConfig(apacheContent);
  return {
    proxy: "apache",
    sites,
    warnings: [...warnings, ...parseWarnings],
  };
}
