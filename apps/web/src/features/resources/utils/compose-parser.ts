export type ParsedPort = {
  publishedPort: number;
  targetPort: number;
  protocol: "tcp" | "udp";
};

export type ParsedVolume = {
  source: string;
  target: string;
  readOnly: boolean;
};

/**
 * Parses port strings like:
 * - "8080:80" -> published: 8080, target: 80, protocol: tcp
 * - "8080:80/udp" -> published: 8080, target: 80, protocol: udp
 * - "127.0.0.1:8080:80/tcp" -> published: 8080, target: 80, protocol: tcp
 * - "80" -> published: 80, target: 80, protocol: tcp
 */
export function parsePortString(raw: string): ParsedPort | null {
  const str = raw.trim();
  if (!str) return null;

  let protocol: "tcp" | "udp" = "tcp";
  let cleanStr = str;
  if (cleanStr.toLowerCase().endsWith("/udp")) {
    protocol = "udp";
    cleanStr = cleanStr.slice(0, -4);
  } else if (cleanStr.toLowerCase().endsWith("/tcp")) {
    protocol = "tcp";
    cleanStr = cleanStr.slice(0, -4);
  }

  const parts = cleanStr.split(":").map((p) => p.trim());
  if (parts.length === 1) {
    const port = Number.parseInt(parts[0], 10);
    if (!Number.isNaN(port) && port > 0 && port <= 65535) {
      return { publishedPort: port, targetPort: port, protocol };
    }
  } else if (parts.length === 2) {
    const published = Number.parseInt(parts[0], 10);
    const target = Number.parseInt(parts[1], 10);
    if (
      !Number.isNaN(published) &&
      published > 0 &&
      published <= 65535 &&
      !Number.isNaN(target) &&
      target > 0 &&
      target <= 65535
    ) {
      return { publishedPort: published, targetPort: target, protocol };
    }
  } else if (parts.length === 3) {
    // e.g. 127.0.0.1:8080:80
    const published = Number.parseInt(parts[1], 10);
    const target = Number.parseInt(parts[2], 10);
    if (
      !Number.isNaN(published) &&
      published > 0 &&
      published <= 65535 &&
      !Number.isNaN(target) &&
      target > 0 &&
      target <= 65535
    ) {
      return { publishedPort: published, targetPort: target, protocol };
    }
  }
  return null;
}

/**
 * Parses volume strings like:
 * - "db_data:/var/lib/mysql" -> source: "db_data", target: "/var/lib/mysql", readOnly: false
 * - "db_data:/var/lib/mysql:ro" -> source: "db_data", target: "/var/lib/mysql", readOnly: true
 * - "/host/dir:/container/dir:rw" -> source: "/host/dir", target: "/container/dir", readOnly: false
 * - "/data" -> source: "data-volume", target: "/data", readOnly: false
 */
export function parseVolumeString(raw: string): ParsedVolume | null {
  const str = raw.trim();
  if (!str) return null;

  const parts = str.split(":");
  if (parts.length === 1) {
    const target = parts[0];
    const sourceName = target.split("/").filter(Boolean).pop() || "volume";
    return { source: `${sourceName}-data`, target, readOnly: false };
  }

  if (parts.length >= 2) {
    const source = parts[0];
    const target = parts[1];
    const mode = parts[2] ? parts[2].trim().toLowerCase() : "rw";
    const readOnly = mode === "ro";
    if (source && target) {
      return { source, target, readOnly };
    }
  }

  return null;
}

/**
 * Extracts unique ports and volumes from service inspection results or objects.
 */
export function extractPortsAndVolumesFromServices(
  services: Array<{ ports?: string[]; volumes?: string[] }>,
): { ports: ParsedPort[]; volumes: ParsedVolume[] } {
  const portsMap = new Map<string, ParsedPort>();
  const volumesMap = new Map<string, ParsedVolume>();

  for (const s of services) {
    if (Array.isArray(s.ports)) {
      for (const p of s.ports) {
        const parsed = parsePortString(p);
        if (parsed) {
          const key = `${parsed.publishedPort}:${parsed.targetPort}/${parsed.protocol}`;
          portsMap.set(key, parsed);
        }
      }
    }
    if (Array.isArray(s.volumes)) {
      for (const v of s.volumes) {
        const parsed = parseVolumeString(v);
        if (parsed) {
          const key = `${parsed.source}:${parsed.target}`;
          volumesMap.set(key, parsed);
        }
      }
    }
  }

  return {
    ports: Array.from(portsMap.values()),
    volumes: Array.from(volumesMap.values()),
  };
}
