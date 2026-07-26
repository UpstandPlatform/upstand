import { resolve4, resolve6, resolveCname } from "node:dns/promises";
import { z } from "zod";

export const ValidateDomainInputSchema = z.object({
  organizationId: z.string().min(1),
  host: z.string().trim().min(1).max(253),
  expectedIp: z.string().trim().optional(),
});

export type ValidateDomainInput = z.infer<typeof ValidateDomainInputSchema>;

type CidrProvider = { name: string; ranges: string[]; warning: string };

const CDN_CNAME_PATTERNS = [
  { name: "Cloudflare", pattern: /\.cloudflare\.net$/i },
  { name: "Fastly", pattern: /\.fastly(g1)?\.net$/i },
  { name: "AWS CloudFront", pattern: /\.cloudfront\.net$/i },
  { name: "Vercel", pattern: /\.vercel-dns\.com$/i },
  { name: "Netlify", pattern: /\.(netlify\.com|netlify\.app)$/i },
  { name: "Akamai", pattern: /\.(edgekey|edgesuite|akamai|akamaized)\.net$/i },
  { name: "Bunny CDN", pattern: /\.b-cdn\.net$/i },
  { name: "Arvancloud", pattern: /\.arvan(cloud)?\.(ir|com)$/i },
];

const CDN_PROVIDERS: CidrProvider[] = [
  {
    name: "Cloudflare",
    ranges: [
      "173.245.48.0/20",
      "103.21.244.0/22",
      "103.22.200.0/22",
      "103.31.4.0/22",
      "141.101.64.0/18",
      "108.162.192.0/18",
      "190.93.240.0/20",
      "188.114.96.0/20",
      "198.41.128.0/17",
      "162.158.0.0/15",
      "104.16.0.0/13",
      "104.24.0.0/14",
      "172.64.0.0/13",
      "131.0.72.0/22",
    ],
    warning: "DNS resolves to Cloudflare; validate the origin separately.",
  },
  {
    name: "Fastly",
    ranges: [
      "23.235.32.0/20",
      "43.249.72.0/22",
      "103.244.50.0/24",
      "103.245.222.0/23",
      "103.245.224.0/24",
      "104.156.80.0/20",
      "140.248.64.0/18",
      "140.248.128.0/17",
      "146.75.0.0/17",
      "151.101.0.0/16",
      "157.52.64.0/18",
      "167.82.0.0/17",
      "167.82.128.0/20",
      "167.82.160.0/20",
      "167.82.224.0/20",
      "172.111.64.0/18",
      "185.31.16.0/22",
      "199.27.72.0/21",
      "199.232.0.0/16",
    ],
    warning: "DNS resolves to Fastly; validate the origin separately.",
  },
  {
    name: "AWS CloudFront",
    ranges: [
      "13.32.0.0/15",
      "13.224.0.0/14",
      "13.249.0.0/16",
      "18.154.0.0/15",
      "18.160.0.0/15",
      "18.164.0.0/15",
      "18.172.0.0/15",
      "18.238.0.0/15",
      "18.244.0.0/15",
      "23.91.0.0/19",
      "23.234.192.0/18",
      "52.46.0.0/18",
      "52.84.0.0/15",
      "52.124.128.0/17",
      "52.222.128.0/17",
      "54.182.0.0/16",
      "54.192.0.0/16",
      "54.230.0.0/16",
      "54.239.0.0/19",
      "54.240.128.0/18",
      "64.252.0.0/16",
      "65.8.0.0/16",
      "65.9.0.0/16",
      "70.132.0.0/18",
      "99.84.0.0/16",
      "99.86.0.0/16",
      "108.156.0.0/14",
      "120.253.240.0/20",
      "130.176.0.0/16",
      "143.204.0.0/16",
      "144.220.0.0/16",
      "204.246.160.0/19",
      "205.251.200.0/19",
      "216.137.32.0/19",
    ],
    warning: "DNS resolves to AWS CloudFront; validate the origin separately.",
  },
  {
    name: "Bunny CDN",
    ranges: [
      "84.17.37.0/24",
      "84.17.47.0/24",
      "84.17.58.0/24",
      "84.17.62.0/24",
      "89.187.160.0/20",
      "89.187.176.0/20",
      "143.244.32.0/20",
      "154.54.0.0/16",
      "162.245.192.0/22",
      "169.150.192.0/20",
      "185.244.0.0/22",
      "191.96.12.0/22",
      "191.96.240.0/20",
      "209.197.64.0/18",
    ],
    warning: "DNS resolves to Bunny CDN; validate the origin separately.",
  },
  {
    name: "Vercel",
    ranges: ["76.76.21.0/24", "76.223.126.0/24"],
    warning: "DNS resolves to Vercel; validate the origin separately.",
  },
  {
    name: "Netlify",
    ranges: [
      "75.2.60.0/24",
      "99.83.190.0/24",
      "104.198.14.0/24",
      "104.248.78.0/24",
      "138.68.244.0/24",
      "142.93.124.0/24",
      "159.203.118.0/24",
      "159.65.216.0/24",
      "159.89.243.0/24",
      "165.227.0.0/16",
      "167.99.129.0/24",
      "178.128.17.0/24",
      "206.189.73.0/24",
    ],
    warning: "DNS resolves to Netlify; validate the origin separately.",
  },
  {
    name: "Arvancloud",
    ranges: [
      "185.143.232.0/22",
      "188.229.116.16/29",
      "94.101.182.0/27",
      "2.144.3.128/28",
      "89.45.48.64/28",
      "37.32.16.0/27",
      "37.32.17.0/27",
      "37.32.18.0/27",
      "37.32.19.0/27",
      "185.215.232.0/22",
      "178.131.120.48/28",
    ],
    warning: "DNS resolves to Arvancloud; validate the origin separately.",
  },
];

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [network, prefixText] = cidr.split("/");
  const prefix = Number(prefixText);
  if (!network || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }
  const toInt = (value: string) =>
    value
      .split(".")
      .reduce((result, octet) => (result << 8) + Number(octet), 0) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (toInt(ip) & mask) === (toInt(network) & mask);
}

function normalizeHost(value: string): string {
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
    ? value
    : `https://${value}`;
  const host = new URL(withProtocol).hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253 || host.includes("..")) {
    throw new Error("A valid domain hostname is required");
  }
  return host;
}

async function detectCDNViaHttp(host: string): Promise<string | null> {
  const protocols = ["https://", "http://"];
  for (const protocol of protocols) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2000); // 2-second timeout
      const res = await fetch(protocol + host, {
        method: "HEAD",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Upstand/1.0",
        },
      });
      clearTimeout(id);

      const server = res.headers.get("server")?.toLowerCase() || "";
      const via = res.headers.get("via")?.toLowerCase() || "";

      if (res.headers.has("cf-ray") || server.includes("cloudflare")) {
        return "Cloudflare";
      }
      if (res.headers.has("x-served-by") || server.includes("fastly")) {
        return "Fastly";
      }
      if (res.headers.has("x-amz-cf-id") || via.includes("cloudfront")) {
        return "AWS CloudFront";
      }
      if (res.headers.has("x-vercel-id") || server.includes("vercel")) {
        return "Vercel";
      }
      if (res.headers.has("x-nf-request-id") || server.includes("netlify")) {
        return "Netlify";
      }
      if (
        res.headers.has("x-bunny-cache") ||
        res.headers.has("x-bunny-server-trace") ||
        server.includes("bunnycdn") ||
        server.includes("bunny")
      ) {
        return "Bunny CDN";
      }
      if (
        res.headers.has("x-akamai-transformed") ||
        server.includes("akamaighost") ||
        server.includes("akamai")
      ) {
        return "Akamai";
      }
      if (
        res.headers.has("ar-ray") ||
        server.includes("arvancloud") ||
        server.includes("arvan")
      ) {
        return "Arvancloud";
      }
    } catch {
      // Ignore: connection issue or domain doesn't support the protocol yet
    }
  }
  return null;
}

export class ValidateDomainUseCase {
  async execute(input: ValidateDomainInput) {
    const host = normalizeHost(input.host);
    let cdnProvider: string | null = null;
    let warning: string | null = null;

    // 1. Try HTTP header check first
    cdnProvider = await detectCDNViaHttp(host);
    if (cdnProvider) {
      warning = `DNS resolves to ${cdnProvider} (detected via HTTP response headers); validate the origin separately.`;
    }

    // 2. Try resolving CNAME records to match against CDN patterns if not detected yet
    if (!cdnProvider) {
      try {
        const cnames = await resolveCname(host);
        for (const cname of cnames) {
          const match = CDN_CNAME_PATTERNS.find((p) => p.pattern.test(cname));
          if (match) {
            cdnProvider = match.name;
            warning = `DNS resolves to ${match.name} (detected via CNAME); validate the origin separately.`;
            break;
          }
        }
      } catch {
        // Ignored: CNAME might not exist
      }
    }

    // 3. Resolve DNS A and AAAA records in parallel
    try {
      const results = await Promise.allSettled([
        resolve4(host),
        resolve6(host),
      ]);

      const ips: string[] = [];
      for (const result of results) {
        if (result.status === "fulfilled") {
          ips.push(...result.value);
        }
      }

      if (ips.length === 0) {
        // If both failed, check if we got any specific errors to throw
        const rejected = results.find((r) => r.status === "rejected") as
          | PromiseRejectedResult
          | undefined;
        throw rejected
          ? rejected.reason
          : new Error("DNS resolution returned no A or AAAA records");
      }

      // If CDN not yet detected, check resolved IP ranges
      if (!cdnProvider) {
        const provider = ips
          .flatMap((ip) =>
            CDN_PROVIDERS.filter((candidate) =>
              candidate.ranges.some((range) => ipv4InCidr(ip, range)),
            ),
          )
          .at(0);
        if (provider) {
          cdnProvider = provider.name;
          warning = provider.warning;
        }
      }

      if (cdnProvider) {
        return {
          host,
          isValid: true,
          resolvedIps: ips,
          cdnProvider,
          warning,
        };
      }

      const matchesExpected = input.expectedIp
        ? ips.includes(input.expectedIp)
        : true;

      return {
        host,
        isValid: matchesExpected,
        resolvedIps: ips,
        cdnProvider: null,
        warning: matchesExpected
          ? null
          : `Domain resolves to ${ips.join(", ")} instead of expected IP ${input.expectedIp}.`,
      };
    } catch (error) {
      return {
        host,
        isValid: false,
        resolvedIps: [],
        cdnProvider,
        warning:
          error instanceof Error ? error.message : "DNS resolution failed",
      };
    }
  }
}
