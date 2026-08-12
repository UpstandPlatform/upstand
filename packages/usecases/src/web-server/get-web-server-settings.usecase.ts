import type { IUnitOfWork, WebServerSettings } from "@upstand/domain";
import { env } from "@upstand/env/server";
import { readResponseJsonLimited } from "@upstand/platform/network/response-body";
import type { CaddyStatus } from "../ports/caddy";
import type { CaddyService } from "./caddy.service";

function addUpstreamRetry(snippets: string, upstream: string): string {
  const legacy = `\treverse_proxy ${upstream}`;
  const resilient = `${legacy} {
\t\tlb_try_duration 30s
\t\tlb_try_interval 250ms
\t}`;

  return snippets.replaceAll(
    `${legacy}\n`,
    snippets.includes(`${legacy} {`) ? `${legacy}\n` : `${resilient}\n`,
  );
}

function controlPlaneUpstream(service: "server" | "web" | "fumadocs"): string {
  const upstreamMap: Record<string, string | undefined> = {
    server: env.UPSTAND_SERVER_UPSTREAM,
    web: env.UPSTAND_WEB_UPSTREAM,
    fumadocs: env.UPSTAND_FUMADOCS_UPSTREAM,
  };
  const configured = upstreamMap[service]?.trim();
  const port = service === "server" ? 3000 : service === "web" ? 3001 : 4000;
  return configured || `${service}:${port}`;
}

function ensureControlPlaneRetries(snippets: string): string {
  const replacements: readonly (readonly [string, string])[] = [
    ["upstand_web:3001", controlPlaneUpstream("web")],
    ["upstand_server:3000", controlPlaneUpstream("server")],
    ["upstand_fumadocs:4000", controlPlaneUpstream("fumadocs")],
  ];
  return replacements.reduce(
    (current, [legacy, upstream]) =>
      addUpstreamRetry(current.replaceAll(legacy, upstream), upstream),
    snippets,
  );
}

type ControlPlaneHosts = {
  dashboardHost?: string;
  apiHost?: string;
  docsHost?: string;
};

type ControlPlaneUpstreams = {
  web: string;
  server: string;
  fumadocs: string;
};

export function applyConfiguredDashboardHost(
  settings: WebServerSettings,
  dashboardHost?: string,
): WebServerSettings {
  const configured = dashboardHost?.trim();
  return configured && !settings.serverDomain
    ? { ...settings, serverDomain: configured }
    : settings;
}

function controlPlaneProxy(upstream: string): string {
  return `	reverse_proxy ${upstream} {
		lb_try_duration 30s
		lb_try_interval 250ms
	}`;
}

export function buildControlPlaneRoutes(
  hosts: ControlPlaneHosts,
  upstreams: ControlPlaneUpstreams = {
    web: controlPlaneUpstream("web"),
    server: controlPlaneUpstream("server"),
    fumadocs: controlPlaneUpstream("fumadocs"),
  },
): string {
  const dashboardHost = hosts.dashboardHost?.trim();
  const apiHost = hosts.apiHost?.trim();
  const docsHost = hosts.docsHost?.trim();
  const validHost = (host: string | undefined) =>
    host && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host);

  if (!validHost(dashboardHost) || !validHost(apiHost)) return "";

  if (dashboardHost === apiHost) {
    return `${dashboardHost} {
	encode zstd gzip
	handle /api/* {
${controlPlaneProxy(upstreams.server)}
	}
	handle {
${controlPlaneProxy(upstreams.web)}
	}
}${
      validHost(docsHost) && docsHost !== dashboardHost
        ? `

${docsHost} {
	encode zstd gzip
${controlPlaneProxy(upstreams.fumadocs)}
}`
        : ""
    }`;
  }

  return `${dashboardHost} {
	encode zstd gzip
${controlPlaneProxy(upstreams.web)}
}

${apiHost} {
	encode zstd gzip
${controlPlaneProxy(upstreams.server)}
}${
    validHost(docsHost) && docsHost !== dashboardHost && docsHost !== apiHost
      ? `

${docsHost} {
	encode zstd gzip
${controlPlaneProxy(upstreams.fumadocs)}
}`
      : ""
  }`;
}

export class GetWebServerSettingsUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly caddyService: CaddyService,
  ) {}

  async execute(options: { reconcile?: boolean } = {}): Promise<{
    settings: WebServerSettings;
    status: CaddyStatus;
  }> {
    let settings = await this.uow.webServerSettingsRepository.findGlobal();
    if (!settings) {
      settings = await this.uow.webServerSettingsRepository.createGlobal({
        caddySnippets: this.getControlPlaneRoutes(),
      });
    } else {
      const docsHost = env.UPSTAND_DOCS_HOST?.trim();
      if (
        docsHost &&
        /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(docsHost) &&
        !settings.caddySnippets.includes(`${docsHost} {`)
      ) {
        const docsRoute = `${docsHost} {
\tencode zstd gzip
\treverse_proxy upstand_fumadocs:4000 {
\t\tlb_try_duration 30s
\t\tlb_try_interval 250ms
\t}`;
        settings =
          (await this.uow.webServerSettingsRepository.updateGlobal({
            caddySnippets: `${settings.caddySnippets.trim()}\n\n${docsRoute}\n}`,
          })) ?? settings;
      }
    }

    const resilientSnippets = ensureControlPlaneRetries(settings.caddySnippets);
    if (resilientSnippets !== settings.caddySnippets) {
      settings =
        (await this.uow.webServerSettingsRepository.updateGlobal({
          caddySnippets: resilientSnippets,
        })) ?? settings;
    }

    if (options.reconcile && !settings.serverIp) {
      let detectedIp = "";
      try {
        const res = await fetch("https://api.ipify.org?format=json", {
          redirect: "error",
          signal: AbortSignal.timeout(3_000),
        });
        if (!res.ok) throw new Error(`IP discovery returned ${res.status}`);
        const data = await readResponseJsonLimited<{ ip: string }>(res, 4096);
        if (data.ip) {
          detectedIp = data.ip;
        }
      } catch {
        try {
          const os = await import("node:os");
          const interfaces = os.networkInterfaces();
          for (const name of Object.keys(interfaces)) {
            for (const net of interfaces[name] || []) {
              if (net.family === "IPv4" && !net.internal) {
                detectedIp = net.address;
                break;
              }
            }
            if (detectedIp) break;
          }
        } catch {
          // Local interface discovery is a best-effort fallback.
        }
      }

      if (detectedIp) {
        const updated = await this.uow.webServerSettingsRepository.updateGlobal(
          {
            serverIp: detectedIp,
          },
        );
        if (updated) {
          settings = updated;
        }
      }
    }

    if (options.reconcile) {
      await this.caddyService.setControlPlaneIpAccess(
        settings.ipAccessEnabled ?? true,
      );
      await this.caddyService.initializeCaddy(settings);
      const [resources, certificates] = await Promise.all([
        this.uow.resourceRepository.findForCaddy?.() ??
          this.uow.resourceRepository.findMany(),
        this.uow.certificateRepository.findAll?.() ?? Promise.resolve([]),
      ]);
      await this.caddyService.syncResourceConfigs(
        resources,
        settings,
        certificates,
      );
    }
    settings = applyConfiguredDashboardHost(
      settings,
      env.UPSTAND_DASHBOARD_HOST,
    );
    const status = await this.caddyService.getStatus();
    return { settings, status };
  }

  private getControlPlaneRoutes(): string {
    return buildControlPlaneRoutes({
      dashboardHost: env.UPSTAND_DASHBOARD_HOST,
      apiHost: env.UPSTAND_API_HOST,
      docsHost: env.UPSTAND_DOCS_HOST,
    });
  }
}
