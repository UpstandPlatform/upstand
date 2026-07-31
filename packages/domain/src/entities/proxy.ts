import { z } from "zod";

export const ProxyKindSchema = z.enum([
  "nginx",
  "caddy",
  "apache",
  "traefik",
  "haproxy",
  "openresty",
  "custom",
  "unknown",
]);

export type ProxyKind = z.infer<typeof ProxyKindSchema>;

export const EdgeClassificationSchema = z.enum([
  "free",
  "ours",
  "known",
  "unknown",
]);

export type EdgeClassification = z.infer<typeof EdgeClassificationSchema>;

export const EdgeOccupantSchema = z.object({
  port: z.number().int().min(1).max(65535),
  pid: z.number().int().positive().optional(),
  command: z.string().optional(),
  rawCommand: z.string().optional(),
  systemdUnit: z.string().optional(),
  systemdDescription: z.string().optional(),
  isDocker: z.boolean().default(false),
  containerName: z.string().optional(),
  proxy: ProxyKindSchema.optional(),
  managedByUpstand: z.boolean().default(false),
});

export type EdgeOccupant = z.infer<typeof EdgeOccupantSchema>;

export const EdgeStatusSchema = z.object({
  classification: EdgeClassificationSchema,
  occupants: z.array(EdgeOccupantSchema).default([]),
  canProceedClean: z.boolean().default(true),
});

export type EdgeStatus = z.infer<typeof EdgeStatusSchema>;

export const ImportedSiteTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("proxy"),
    url: z.string().url().or(z.string().min(1)),
  }),
  z.object({
    kind: z.literal("static"),
    root: z.string().min(1),
  }),
]);

export type ImportedSiteTarget = z.infer<typeof ImportedSiteTargetSchema>;

export const ImportedSiteRouteSchema = z.object({
  path: z.string().min(1),
  url: z.string().min(1),
});

export type ImportedSiteRoute = z.infer<typeof ImportedSiteRouteSchema>;

export const ImportedSiteTlsSchema = z.object({
  certPath: z.string().min(1),
  keyPath: z.string().min(1),
});

export type ImportedSiteTls = z.infer<typeof ImportedSiteTlsSchema>;

export const ImportedSiteSchema = z.object({
  serverNames: z.array(z.string().min(1)).min(1),
  ssl: z.boolean().default(false),
  target: ImportedSiteTargetSchema,
  routes: z.array(ImportedSiteRouteSchema).optional(),
  tls: ImportedSiteTlsSchema.optional(),
  source: z.string().optional(),
});

export type ImportedSite = z.infer<typeof ImportedSiteSchema>;

export const ProxyScanResultSchema = z.object({
  proxy: ProxyKindSchema,
  sites: z.array(ImportedSiteSchema).default([]),
  warnings: z.array(z.string()).default([]),
});

export type ProxyScanResult = z.infer<typeof ProxyScanResultSchema>;

export const AdoptedCertSchema = z.object({
  domain: z.string().min(1),
  certPath: z.string().min(1),
  keyPath: z.string().min(1),
  certContent: z.string().optional(),
  keyContent: z.string().optional(),
  issuer: z.string().optional(),
  expiresAt: z.date().optional(),
});

export type AdoptedCert = z.infer<typeof AdoptedCertSchema>;

export const ProxyTakeoverStatusSchema = z.enum([
  "planned",
  "migrating",
  "active",
  "rolled_back",
  "failed",
]);

export type ProxyTakeoverStatus = z.infer<typeof ProxyTakeoverStatusSchema>;

export const ProxyTakeoverJournalSchema = z.object({
  id: z.string().min(1),
  serverId: z.string().min(1),
  previousProxy: ProxyKindSchema,
  occupiedPorts: z.array(z.number().int()).default([]),
  stopTargets: z
    .array(
      z.object({
        port: z.number().int().optional(),
        unit: z.string().optional(),
        pid: z.number().int().optional(),
        container: z.string().optional(),
        label: z.string().optional(),
      }),
    )
    .default([]),
  importedSites: z.array(ImportedSiteSchema).default([]),
  status: ProxyTakeoverStatusSchema,
  error: z.string().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ProxyTakeoverJournal = z.infer<typeof ProxyTakeoverJournalSchema>;
