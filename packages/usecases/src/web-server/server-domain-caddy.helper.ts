import type { WebServerSettings } from "@upstand/domain";
import { env } from "@upstand/env/server";

export const SERVER_DOMAIN_MARKER_START =
  "# --- Upstand Server Domain Start ---";
export const SERVER_DOMAIN_MARKER_END = "# --- Upstand Server Domain End ---";

export function buildServerDomainCaddySnippet(
  settings?: Partial<WebServerSettings>,
): string {
  const domain = settings?.serverDomain?.trim();
  if (!domain || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(domain)) {
    return "";
  }

  const httpsEnabled = settings?.httpsEnabled ?? true;
  const provider = settings?.certificateProvider ?? "letsencrypt";
  const email = settings?.letsEncryptEmail?.trim();

  const serverUpstream =
    env.UPSTAND_SERVER_UPSTREAM?.trim() || "upstand_server:3000";
  const webUpstream = env.UPSTAND_WEB_UPSTREAM?.trim() || "upstand_web:3001";

  if (!httpsEnabled || provider === "none") {
    return `http://${domain} {
\tencode zstd gzip
\treverse_proxy /api/* ${serverUpstream} {
\t\tlb_try_duration 30s
\t\tlb_try_interval 250ms
\t}
\treverse_proxy ${webUpstream} {
\t\tlb_try_duration 30s
\t\tlb_try_interval 250ms
\t}
}`;
  }

  let tlsDirective = "";
  if (provider === "self-signed") {
    tlsDirective = "\ttls internal";
  } else if (provider === "custom") {
    const certId = settings?.certificateId?.trim();
    tlsDirective = certId
      ? `\ttls /etc/caddy/certificates/${certId}.crt /etc/caddy/certificates/${certId}.key`
      : "\ttls internal";
  } else if (provider === "zerossl") {
    tlsDirective = email
      ? `\ttls ${email} {\n\t\tca https://acme.zerossl.com/v2/DV90\n\t}`
      : "\ttls {\n\t\tca https://acme.zerossl.com/v2/DV90\n\t}";
  } else {
    // Default: Let's Encrypt
    tlsDirective = email ? `\ttls ${email}` : "";
  }

  return `${domain} {
\tencode zstd gzip
${tlsDirective ? `${tlsDirective}\n` : ""}\treverse_proxy /api/* ${serverUpstream} {
\t\tlb_try_duration 30s
\t\tlb_try_interval 250ms
\t}
\treverse_proxy ${webUpstream} {
\t\tlb_try_duration 30s
\t\tlb_try_interval 250ms
\t}
}`;
}

export function syncServerDomainInCaddySnippets(
  existingSnippets: string,
  settings: Partial<WebServerSettings>,
): string {
  const snippet = buildServerDomainCaddySnippet(settings);
  const block = snippet
    ? `${SERVER_DOMAIN_MARKER_START}\n${snippet}\n${SERVER_DOMAIN_MARKER_END}`
    : "";

  const pattern = new RegExp(
    `${SERVER_DOMAIN_MARKER_START}[\\s\\S]*?${SERVER_DOMAIN_MARKER_END}\\n?\\n?`,
    "g",
  );

  const cleaned = existingSnippets.replace(pattern, "").trim();

  if (!block) {
    return cleaned;
  }

  return cleaned ? `${block}\n\n${cleaned}` : block;
}
