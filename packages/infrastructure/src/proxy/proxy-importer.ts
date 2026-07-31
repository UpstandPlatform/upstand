import type { AdoptedCert, ProxyKind, ProxyScanResult } from "@upstand/domain";
import type { CommandExecutor, IProxyImporter } from "@upstand/usecases";
import { scanApacheProxy } from "./import/apache-importer";
import {
  extractCaddyCertificates,
  scanCaddyProxy,
} from "./import/caddy-importer";
import {
  extractNginxCertificates,
  scanNginxProxy,
} from "./import/nginx-importer";
import {
  extractTraefikCertificates,
  scanTraefikProxy,
} from "./import/traefik-importer";

export class DefaultProxyImporter implements IProxyImporter {
  canImportProxy(kind: ProxyKind): boolean {
    return (
      kind === "caddy" ||
      kind === "traefik" ||
      kind === "nginx" ||
      kind === "apache" ||
      kind === "openresty"
    );
  }

  async scanImportableSites(
    executor?: CommandExecutor,
    kind?: ProxyKind,
    _serverId?: string,
  ): Promise<ProxyScanResult> {
    const targetKind = kind ?? "caddy";
    switch (targetKind) {
      case "caddy":
        return scanCaddyProxy(executor);
      case "traefik":
        return scanTraefikProxy(executor);
      case "nginx":
      case "openresty":
        return scanNginxProxy(executor);
      case "apache":
        return scanApacheProxy(executor);
      default:
        return {
          proxy: targetKind,
          sites: [],
          warnings: [
            `Config import not supported for proxy kind: '${targetKind}'`,
          ],
        };
    }
  }

  async extractCertificates(
    executor?: CommandExecutor,
    _serverId?: string,
  ): Promise<AdoptedCert[]> {
    const [caddyCerts, traefikCerts, nginxCerts] = await Promise.all([
      extractCaddyCertificates(executor),
      extractTraefikCertificates(executor),
      extractNginxCertificates(executor),
    ]);
    return [...caddyCerts, ...traefikCerts, ...nginxCerts];
  }
}
