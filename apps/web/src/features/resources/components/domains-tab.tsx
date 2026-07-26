"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { parseResourceAdvancedConfig } from "@upstand/domain";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@upstand/ui/components/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@upstand/ui/components/field";
import { Input } from "@upstand/ui/components/input";
import { Label } from "@upstand/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Switch } from "@upstand/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@upstand/ui/components/table";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import z from "zod";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import {
  ChevronDownIcon,
  Pencil,
  Trash2,
  WandSparkles,
} from "@/components/huge-icons";
import { trpc } from "@/utils/trpc";
import type { ResourceDetailState } from "../hooks/use-resource-detail";

type DomainMapping = {
  enabled: boolean;
  host: string;
  path: string;
  internalPath: string;
  stripPath: boolean;
  port: number;
  serviceName?: string;
  https: boolean;
  certificateType:
    | "letsencrypt"
    | "zerossl"
    | "internal"
    | "custom"
    | "cloudflare";
  certificateId?: string;
  middlewares: string[];
  redirectTo?: string;
  redirectStatus: "301" | "302" | "307" | "308";
  forwardAuth?: {
    address: string;
    uri: string;
    copyHeaders: string[];
  };
  basicAuth?: {
    username: string;
    passwordHash: string;
  };
  securityHeaders: {
    hsts: boolean;
    nosniff: boolean;
    frameDeny: boolean;
    referrerPolicy:
      | "no-referrer"
      | "same-origin"
      | "strict-origin"
      | "strict-origin-when-cross-origin"
      | null;
  };
};

interface DomainsTabProps {
  organizationId: string;
  resource: NonNullable<ResourceDetailState["resource"]>;
  updateResource: ResourceDetailState["updateResource"];
  isUpdatingResource: boolean;
  routingTargets: string[];
  certificates: Array<{ id: string; name: string }>;
  servers: Array<{ id: string; ipAddress?: string | null }>;
}

const emptyDomainMapping = (): DomainMapping => ({
  enabled: true,
  host: "",
  path: "/",
  internalPath: "/",
  stripPath: true,
  port: 80,
  https: true,
  certificateType: "letsencrypt",
  middlewares: [],
  redirectTo: "",
  redirectStatus: "302",
  forwardAuth: {
    address: "",
    uri: "/verify",
    copyHeaders: [],
  },
  basicAuth: {
    username: "",
    passwordHash: "",
  },
  securityHeaders: {
    hsts: false,
    nosniff: true,
    frameDeny: false,
    referrerPolicy: "strict-origin-when-cross-origin",
  },
});

function isPublicIpv4(value: string | undefined): value is string {
  if (!value) return false;
  const octets = value.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [first, second] = octets;
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

const parseDomainMappings = (
  value: string | null | undefined,
): DomainMapping[] => {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const mapping = item as Partial<DomainMapping>;
      return [
        {
          enabled: mapping.enabled !== false,
          host: typeof mapping.host === "string" ? mapping.host : "",
          path: typeof mapping.path === "string" ? mapping.path : "/",
          internalPath:
            typeof mapping.internalPath === "string"
              ? mapping.internalPath
              : "/",
          stripPath:
            typeof mapping.stripPath === "boolean" ? mapping.stripPath : true,
          port: typeof mapping.port === "number" ? mapping.port : 80,
          serviceName:
            typeof mapping.serviceName === "string"
              ? mapping.serviceName
              : undefined,
          https: typeof mapping.https === "boolean" ? mapping.https : true,
          certificateType:
            mapping.certificateType === "zerossl"
              ? "zerossl"
              : mapping.certificateType === "internal"
                ? "internal"
                : mapping.certificateType === "custom"
                  ? "custom"
                  : mapping.certificateType === "cloudflare"
                    ? "cloudflare"
                    : "letsencrypt",
          certificateId:
            typeof mapping.certificateId === "string"
              ? mapping.certificateId
              : undefined,
          middlewares: Array.isArray(mapping.middlewares)
            ? mapping.middlewares
            : [],
          redirectTo:
            typeof mapping.redirectTo === "string" ? mapping.redirectTo : "",
          redirectStatus:
            mapping.redirectStatus === "301" ||
            mapping.redirectStatus === "307" ||
            mapping.redirectStatus === "308"
              ? mapping.redirectStatus
              : "302",
          forwardAuth:
            typeof mapping.forwardAuth === "object" &&
            mapping.forwardAuth !== null
              ? {
                  address:
                    typeof mapping.forwardAuth.address === "string"
                      ? mapping.forwardAuth.address
                      : "",
                  uri:
                    typeof mapping.forwardAuth.uri === "string"
                      ? mapping.forwardAuth.uri
                      : "/verify",
                  copyHeaders: Array.isArray(mapping.forwardAuth.copyHeaders)
                    ? mapping.forwardAuth.copyHeaders.filter(
                        (header): header is string =>
                          typeof header === "string",
                      )
                    : [],
                }
              : { address: "", uri: "/verify", copyHeaders: [] },
          basicAuth:
            typeof mapping.basicAuth === "object" && mapping.basicAuth !== null
              ? {
                  username:
                    typeof mapping.basicAuth.username === "string"
                      ? mapping.basicAuth.username
                      : "",
                  passwordHash:
                    typeof mapping.basicAuth.passwordHash === "string"
                      ? mapping.basicAuth.passwordHash
                      : "",
                }
              : { username: "", passwordHash: "" },
          securityHeaders: {
            hsts: Boolean(mapping.securityHeaders?.hsts),
            nosniff: mapping.securityHeaders?.nosniff !== false,
            frameDeny: Boolean(mapping.securityHeaders?.frameDeny),
            referrerPolicy:
              mapping.securityHeaders?.referrerPolicy ??
              "strict-origin-when-cross-origin",
          },
        },
      ];
    });
  } catch {
    return [];
  }
};

export function DomainsTab({
  organizationId,
  resource,
  updateResource,
  isUpdatingResource,
  routingTargets,
  certificates,
  servers,
}: DomainsTabProps) {
  const [domainList, setDomainList] = useState<DomainMapping[]>([]);
  const [domainDialogOpen, setDomainDialogOpen] = useState(false);
  const [editingDomainIndex, setEditingDomainIndex] = useState<number | null>(
    null,
  );
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(
    null,
  );
  const domainVersion = resource?.domains ?? "";

  const suggestedPorts = useMemo(() => {
    if (!resource?.advancedConfig) return [];
    try {
      const parsed = parseResourceAdvancedConfig(resource.advancedConfig);
      const set = new Set<number>();
      for (const p of parsed.ports) {
        if (p.targetPort) set.add(p.targetPort);
        if (p.publishedPort) set.add(p.publishedPort);
      }
      return Array.from(set);
    } catch {
      return [];
    }
  }, [resource?.advancedConfig]);

  interface DnsStatus {
    status: "idle" | "checking" | "verified" | "cdn" | "invalid" | "failed";
    message: string;
    cdnProvider?: string | null;
    resolvedIps?: string[];
  }
  const [dnsStatusMap, setDnsStatusMap] = useState<Record<string, DnsStatus>>(
    {},
  );

  const validateDomain = useMutation({
    ...trpc.domain.validate.mutationOptions(),
    onSuccess: (result, variables) => {
      const host = variables.host;
      const expectedIp = variables.expectedIp;
      if (result.cdnProvider) {
        setDnsStatusMap((prev) => ({
          ...prev,
          [host]: {
            status: "cdn",
            message:
              result.warning || `${host} is behind ${result.cdnProvider}`,
            cdnProvider: result.cdnProvider,
            resolvedIps: result.resolvedIps,
          },
        }));
        toast.success(`DNS check: ${host} is behind ${result.cdnProvider}`, {
          description: `Resolves to CDN IPs: ${result.resolvedIps?.join(", ")}`,
        });
      } else if (result.isValid) {
        setDnsStatusMap((prev) => ({
          ...prev,
          [host]: {
            status: "verified",
            message: "DNS resolves successfully to the expected target IP.",
            resolvedIps: result.resolvedIps,
          },
        }));
        toast.success(`DNS check: ${host} resolves successfully`, {
          description: expectedIp
            ? `Resolves to expected IP: ${expectedIp}`
            : `Resolves to: ${result.resolvedIps?.join(", ")}`,
        });
      } else {
        const msg =
          result.warning ||
          `Domain did not resolve to expected IP: ${expectedIp}`;
        setDnsStatusMap((prev) => ({
          ...prev,
          [host]: {
            status: "invalid",
            message: msg,
            resolvedIps: result.resolvedIps,
          },
        }));
        toast.error(`DNS check: ${host} is unverified`, {
          description: msg,
        });
      }
    },
    onError: (error, variables) => {
      const host = variables.host;
      setDnsStatusMap((prev) => ({
        ...prev,
        [host]: {
          status: "failed",
          message: error.message || "DNS resolution failed.",
        },
      }));
      toast.error(`DNS check failed for ${host}`, {
        description: error.message,
      });
    },
  });
  const webServerSettings = useQuery({
    ...trpc.webServer.getSettings.queryOptions(),
  });

  const validateHost = (host: string) => {
    const resourceServer = servers.find(
      (server) => server.id === resource.serverId,
    );
    const defaultIp = resourceServer?.ipAddress?.match(
      /^(?:\d{1,3}\.){3}\d{1,3}$/,
    )?.[0];
    const configuredIp = webServerSettings.data?.settings.serverIp?.trim();
    const expectedIp = configuredIp || defaultIp;

    setDnsStatusMap((prev) => ({
      ...prev,
      [host]: { status: "checking", message: "Verifying DNS records..." },
    }));

    validateDomain.mutate({ organizationId, host, expectedIp });
  };

  useEffect(() => {
    setDomainList(parseDomainMappings(domainVersion));
  }, [domainVersion]);

  const form = useForm({
    defaultValues: emptyDomainMapping(),
    onSubmit: async ({ value }) => {
      const mapping: DomainMapping = {
        enabled: value.enabled,
        host: value.host.trim().toLowerCase(),
        path: value.path.trim(),
        internalPath: value.internalPath.trim(),
        stripPath: value.stripPath,
        port: Number(value.port),
        serviceName:
          resource.type === "compose" ? value.serviceName : undefined,
        https: value.https,
        certificateType: value.certificateType,
        certificateId:
          value.certificateType === "custom" ? value.certificateId : undefined,
        middlewares: value.middlewares,
        redirectTo: value.redirectTo?.trim() || undefined,
        redirectStatus: value.redirectStatus,
        forwardAuth: value.forwardAuth?.address.trim()
          ? {
              address: value.forwardAuth.address.trim(),
              uri: value.forwardAuth.uri.trim() || "/verify",
              copyHeaders: value.forwardAuth.copyHeaders,
            }
          : undefined,
        basicAuth:
          value.basicAuth?.username.trim() &&
          value.basicAuth.passwordHash.trim()
            ? {
                username: value.basicAuth.username.trim(),
                passwordHash: value.basicAuth.passwordHash.trim(),
              }
            : undefined,
        securityHeaders: value.securityHeaders,
      };

      const updated = [...domainList];
      if (editingDomainIndex !== null) {
        updated[editingDomainIndex] = mapping;
      } else {
        updated.push(mapping);
      }

      updateResource(
        { id: resource.id, domains: JSON.stringify(updated) },
        {
          onSuccess: () => {
            toast.success("Domain mapping updated successfully");
            setDomainDialogOpen(false);
          },
        },
      );
    },
    validators: {
      onSubmit: z.object({
        enabled: z.boolean(),
        host: z
          .string()
          .min(1, "Hostname is required")
          .regex(
            /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i,
            "Enter a valid hostname such as app.example.com",
          ),
        port: z
          .number()
          .min(1, "Port must be >= 1")
          .max(65535, "Port must be <= 65535"),
        path: z.string().startsWith("/", "Path must start with '/'"),
        internalPath: z
          .string()
          .startsWith("/", "Internal path must start with '/'"),
        stripPath: z.boolean(),
        https: z.boolean(),
        certificateType: z.enum([
          "letsencrypt",
          "zerossl",
          "internal",
          "custom",
          "cloudflare",
        ]),
        certificateId: z.string().optional(),
        middlewares: z.array(z.string()),
        redirectTo: z
          .string()
          .refine(
            (value) =>
              !value || /^(?:https?:\/\/[^\r\n]+|\/[^\r\n]*)$/i.test(value),
            "Use a relative path or HTTP(S) URL",
          ),
        redirectStatus: z.enum(["301", "302", "307", "308"]),
        forwardAuth: z.object({
          address: z.string().refine((value) => {
            if (!value.trim()) return true;
            try {
              const url = new URL(value);
              return (
                (url.protocol === "http:" || url.protocol === "https:") &&
                !url.username &&
                !url.password &&
                !url.hash
              );
            } catch {
              return false;
            }
          }, "Use an HTTP(S) auth endpoint without credentials or fragments"),
          uri: z
            .string()
            .regex(
              /^\/[A-Za-z0-9._~!$&'()+,;=:@%/?-]*$/,
              "Use a safe auth path",
            ),
          copyHeaders: z.array(z.string()).max(32),
        }),
        basicAuth: z
          .object({
            username: z
              .string()
              .refine(
                (value) =>
                  !value.trim() || /^[A-Za-z0-9._-]{1,128}$/.test(value),
                "Use letters, numbers, dots, underscores, or dashes",
              ),
            passwordHash: z
              .string()
              .refine(
                (value) =>
                  !value.trim() ||
                  (value.trim().startsWith("$") &&
                    value.trim().length >= 20 &&
                    !/[\s\r\n]/.test(value)),
                "Use a Caddy-compatible password hash, not plaintext",
              ),
          })
          .refine(
            ({ username, passwordHash }) =>
              Boolean(username.trim()) === Boolean(passwordHash.trim()),
            "Provide both a username and a Caddy password hash, or leave both empty",
          ),
        securityHeaders: z.object({
          hsts: z.boolean(),
          nosniff: z.boolean(),
          frameDeny: z.boolean(),
          referrerPolicy: z
            .enum([
              "no-referrer",
              "same-origin",
              "strict-origin",
              "strict-origin-when-cross-origin",
            ])
            .nullable(),
        }),
        serviceName: z.string().optional(),
      }),
    },
  });

  const editDomain = (idx: number) => {
    setEditingDomainIndex(idx);
    const domain = domainList[idx];
    if (!domain) return;
    form.reset(domain);
    setDomainDialogOpen(true);
  };

  const deleteDomain = (idx: number) => {
    const updated = domainList.filter((_, i) => i !== idx);
    updateResource(
      { id: resource.id, domains: JSON.stringify(updated) },
      {
        onSuccess: () => {
          toast.success("Domain mapping removed");
          setPendingDeleteIndex(null);
        },
      },
    );
  };

  const toggleDomain = (idx: number, enabled: boolean) => {
    const updated = domainList.map((mapping, index) =>
      index === idx ? { ...mapping, enabled } : mapping,
    );
    updateResource(
      { id: resource.id, domains: JSON.stringify(updated) },
      {
        onSuccess: () =>
          toast.success(
            enabled ? "Domain route enabled" : "Domain route disabled",
          ),
      },
    );
  };

  const openAddDomain = () => {
    setEditingDomainIndex(null);
    form.reset();
    setDomainDialogOpen(true);
  };

  const generateSslipDomain = () => {
    const resourceServer = servers.find(
      (server) => server.id === resource.serverId,
    );
    const defaultIp = resourceServer?.ipAddress?.match(
      /^(?:\d{1,3}\.){3}\d{1,3}$/,
    )?.[0];
    const configuredIp = webServerSettings.data?.settings.serverIp?.trim();
    const ip = configuredIp || defaultIp;
    if (!isPublicIpv4(ip)) {
      toast.error(
        "Set the installation's public IPv4 address before generating sslip.io domains",
      );
      return;
    }
    const name =
      String(resource.appName || resource.name || "app")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32) || "app";
    const normalizedIp = ip.split(".").map(Number).join(".");
    const host = `${name}-${String(resource.id).slice(0, 8)}.${normalizedIp}.sslip.io`;
    if (domainList.some((domain) => domain.host === host)) {
      toast.info("This generated domain is already linked");
      return;
    }
    // Keep optional Caddy middleware keys absent. Empty nested objects are not
    // valid Caddy routes and used to make generated domains fail in production.
    const mapping: DomainMapping = {
      enabled: true,
      host,
      path: "/",
      internalPath: "/",
      stripPath: true,
      port: 80,
      https: true,
      certificateType: "letsencrypt",
      middlewares: [],
      redirectStatus: "302",
      securityHeaders: emptyDomainMapping().securityHeaders,
    };
    updateResource(
      { id: resource.id, domains: JSON.stringify([...domainList, mapping]) },
      {
        onSuccess: () => toast.success(`Generated ${host}`),
      },
    );
  };

  return (
    <>
      <Card className="border border-border/40 bg-card/20">
        <CardHeader>
          <CardTitle className="font-semibold text-lg">
            Domains & HTTPS
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm">
            Route a public hostname to a service on the overlay network. HTTPS
            uses Caddy Automatic HTTPS and Let's Encrypt.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 border-border/20 border-t pt-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="font-medium text-sm">Public routes</p>
              <p className="font-normal text-muted-foreground text-xs">
                Add hostnames and route them to this resource's internal
                service.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={generateSslipDomain}
                disabled={isUpdatingResource}
              >
                <WandSparkles className="mr-2 size-4" />
                Generate sslip.io
              </Button>
              <Button type="button" onClick={openAddDomain}>
                <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
                Add domain
              </Button>
            </div>
          </div>

          {domainList.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-border/20">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/20 text-muted-foreground text-xs uppercase">
                    <TableHead>Hostname</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Security</TableHead>
                    <TableHead>DNS Status</TableHead>
                    <TableHead className="w-40 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {domainList.map((item, idx) => (
                    <TableRow key={`${item.host}:${item.path}`}>
                      <TableCell>
                        <div className="flex min-w-48 flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={item.enabled}
                              disabled={isUpdatingResource}
                              aria-label={`${item.enabled ? "Disable" : "Enable"} ${item.host}${item.path}`}
                              onCheckedChange={(checked) =>
                                toggleDomain(idx, checked)
                              }
                            />
                            <span
                              className={
                                item.enabled
                                  ? "font-medium text-primary"
                                  : "font-medium text-muted-foreground line-through"
                              }
                            >
                              {item.host}
                            </span>
                          </div>
                          <span className="font-normal text-muted-foreground text-xs">
                            {!item.enabled
                              ? "Disabled · kept for later"
                              : item.stripPath
                                ? "Path prefix removed"
                                : "Path preserved"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="min-w-28 font-mono text-xs">
                        <div>{item.path}</div>
                        {item.internalPath !== "/" && (
                          <div className="font-normal text-muted-foreground">
                            → {item.internalPath}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="min-w-40 font-mono text-muted-foreground text-xs">
                        {item.serviceName || resource?.appName || resource?.name
                          ? `${item.serviceName || resource?.appName || resource?.name}:${item.port}`
                          : item.port}
                      </TableCell>
                      <TableCell className="min-w-32">
                        <Badge variant={item.https ? "default" : "secondary"}>
                          {item.https
                            ? item.certificateType === "internal"
                              ? "HTTPS / Internal CA"
                              : item.certificateType === "zerossl"
                                ? "HTTPS / ZeroSSL"
                                : item.certificateType === "cloudflare"
                                  ? "HTTPS / Cloudflare DNS-01"
                                  : item.certificateType === "custom"
                                    ? "HTTPS / Custom SSL"
                                    : "HTTPS / Let’s Encrypt"
                            : "HTTP only"}
                        </Badge>
                      </TableCell>
                      <TableCell className="min-w-44">
                        {(() => {
                          const statusInfo = dnsStatusMap[item.host];
                          if (!statusInfo) {
                            return (
                              <Badge
                                variant="outline"
                                className="cursor-default"
                              >
                                <span className="mr-1.5 size-1.5 rounded-full bg-muted-foreground/50" />
                                Unchecked
                              </Badge>
                            );
                          }
                          switch (statusInfo.status) {
                            case "checking":
                              return (
                                <Badge
                                  variant="info"
                                  className="animate-pulse cursor-default"
                                >
                                  <span className="mr-1.5 size-1.5 animate-ping rounded-full bg-info" />
                                  Checking...
                                </Badge>
                              );
                            case "verified":
                              return (
                                <Badge
                                  variant="success"
                                  className="cursor-help"
                                  title={`${statusInfo.message}${statusInfo.resolvedIps ? ` Resolved IPs: ${statusInfo.resolvedIps.join(", ")}` : ""}`}
                                >
                                  <span className="mr-1.5 size-1.5 rounded-full bg-success" />
                                  Verified
                                </Badge>
                              );
                            case "cdn":
                              return (
                                <Badge
                                  variant="info"
                                  className="cursor-help"
                                  title={`${statusInfo.message}${statusInfo.resolvedIps ? ` Resolved IPs: ${statusInfo.resolvedIps.join(", ")}` : ""}`}
                                >
                                  <span className="mr-1.5 size-1.5 rounded-full bg-info" />
                                  {statusInfo.cdnProvider || "CDN"}
                                </Badge>
                              );
                            case "invalid":
                              return (
                                <Badge
                                  variant="warning"
                                  className="cursor-help"
                                  title={`${statusInfo.message}${statusInfo.resolvedIps ? ` Resolved IPs: ${statusInfo.resolvedIps.join(", ")}` : ""}`}
                                >
                                  <span className="mr-1.5 size-1.5 rounded-full bg-warning" />
                                  Unverified IP
                                </Badge>
                              );
                            case "failed":
                              return (
                                <Badge
                                  variant="destructive"
                                  className="cursor-help"
                                  title={statusInfo.message}
                                >
                                  <span className="mr-1.5 size-1.5 rounded-full bg-destructive" />
                                  Unresolved
                                </Badge>
                              );
                            default:
                              return null;
                          }
                        })()}
                      </TableCell>
                      <TableCell className="text-right">
                        {(() => {
                          const isCheckingRow =
                            validateDomain.isPending &&
                            validateDomain.variables?.host === item.host;
                          return (
                            <Button
                              type="button"
                              onClick={() => validateHost(item.host)}
                              variant="ghost"
                              size="sm"
                              disabled={isCheckingRow}
                            >
                              {isCheckingRow ? (
                                <>
                                  <span className="mr-1.5 size-3 animate-spin rounded-full border border-current border-t-transparent" />
                                  Checking
                                </>
                              ) : (
                                "DNS check"
                              )}
                            </Button>
                          );
                        })()}
                        <Button
                          type="button"
                          onClick={() => editDomain(idx)}
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${item.host}${item.path}`}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          onClick={() => setPendingDeleteIndex(idx)}
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${item.host}${item.path}`}
                          className="text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No external domains linked.
            </div>
          )}
        </CardContent>

        <Dialog open={domainDialogOpen} onOpenChange={setDomainDialogOpen}>
          <DialogContent className="no-scrollbar max-h-[min(90dvh,56rem)] w-[calc(100%-1rem)] sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingDomainIndex !== null
                  ? "Edit domain route"
                  : "Link domain hostname"}
              </DialogTitle>
              <DialogDescription>
                Assign a hostname and path rule to route traffic from public
                ports to the container overlay port.
              </DialogDescription>
            </DialogHeader>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                form.handleSubmit();
              }}
            >
              <FieldGroup>
                <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
                  <form.Field
                    name="host"
                    validators={{
                      onChange: z.string().min(1, "Hostname is required"),
                    }}
                  >
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor={field.name}>
                          Domain Hostname
                        </FieldLabel>
                        <Input
                          id={field.name}
                          name={field.name}
                          placeholder="app.example.com…"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )}
                  </form.Field>

                  <form.Field name="port">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor={field.name}>
                          Target Port
                        </FieldLabel>
                        <Input
                          id={field.name}
                          name={field.name}
                          type="number"
                          placeholder="80"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) =>
                            field.handleChange(Number(e.target.value))
                          }
                        />
                        {suggestedPorts.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
                            <span>Configured ports:</span>
                            {suggestedPorts.map((p) => (
                              <Button
                                key={p}
                                type="button"
                                variant={
                                  field.state.value === p
                                    ? "default"
                                    : "outline"
                                }
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() => field.handleChange(p)}
                              >
                                {p}
                              </Button>
                            ))}
                          </div>
                        )}
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )}
                  </form.Field>
                </div>

                {resource.type === "compose" && (
                  <form.Field name="serviceName">
                    {(field) => (
                      <Field>
                        <FieldLabel>Compose Service Target</FieldLabel>
                        <Select
                          items={routingTargets.map((target) => ({
                            value: target,
                            label: target,
                          }))}
                          value={field.state.value}
                          onValueChange={(val) =>
                            field.handleChange(val || undefined)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Choose a Compose service" />
                          </SelectTrigger>
                          <SelectContent>
                            {routingTargets.map((target) => (
                              <SelectItem key={target} value={target}>
                                {target}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    )}
                  </form.Field>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <form.Field name="path">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor={field.name}>
                          Public Path Prefix
                        </FieldLabel>
                        <Input
                          id={field.name}
                          name={field.name}
                          placeholder="/"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )}
                  </form.Field>

                  <form.Field name="internalPath">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor={field.name}>
                          Internal Path Target
                        </FieldLabel>
                        <Input
                          id={field.name}
                          name={field.name}
                          placeholder="/"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )}
                  </form.Field>
                </div>

                <form.Field name="stripPath">
                  {(field) => (
                    <Label className="flex items-center gap-3 text-sm">
                      <Switch
                        checked={field.state.value}
                        onCheckedChange={(val) => field.handleChange(val)}
                      />{" "}
                      Strip Path Prefix before passing request downstream.
                    </Label>
                  )}
                </form.Field>

                <form.Field name="https">
                  {(field) => (
                    <Label className="flex items-center gap-3 text-sm">
                      <Switch
                        checked={field.state.value}
                        onCheckedChange={(val) => field.handleChange(val)}
                      />{" "}
                      Force HTTPS Redirection.
                    </Label>
                  )}
                </form.Field>

                <form.Subscribe selector={(state) => state.values.https}>
                  {(https) =>
                    https ? (
                      <form.Field name="certificateType">
                        {(field) => (
                          <Field>
                            <FieldLabel>SSL Certificate Type</FieldLabel>
                            <Select
                              items={[
                                {
                                  value: "letsencrypt",
                                  label: "Let's Encrypt Public Certificate",
                                },
                                {
                                  value: "zerossl",
                                  label: "ZeroSSL Public Certificate",
                                },
                                {
                                  value: "cloudflare",
                                  label: "Cloudflare DNS-01 Wildcard SSL",
                                },
                                {
                                  value: "internal",
                                  label: "Internal CA Self-Signed Certificate",
                                },
                                {
                                  value: "custom",
                                  label: "Uploaded Custom Certificate",
                                },
                              ]}
                              value={field.state.value}
                              onValueChange={(val) =>
                                field.handleChange(
                                  (val || "letsencrypt") as
                                    | "letsencrypt"
                                    | "zerossl"
                                    | "internal"
                                    | "custom"
                                    | "cloudflare",
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="letsencrypt">
                                  Let's Encrypt Public Certificate
                                </SelectItem>
                                <SelectItem value="zerossl">
                                  ZeroSSL Public Certificate
                                </SelectItem>
                                <SelectItem value="cloudflare">
                                  Cloudflare DNS-01 Wildcard SSL
                                </SelectItem>
                                <SelectItem value="internal">
                                  Internal CA Self-Signed Certificate
                                </SelectItem>
                                <SelectItem value="custom">
                                  Uploaded Custom Certificate
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            {field.state.value === "custom" && (
                              <form.Field name="certificateId">
                                {(certificateField) => (
                                  <Select
                                    items={certificates.map((certificate) => ({
                                      value: certificate.id,
                                      label: certificate.name,
                                    }))}
                                    value={certificateField.state.value}
                                    onValueChange={(value) =>
                                      certificateField.handleChange(value || "")
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select a certificate" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {certificates.map((certificate) => (
                                        <SelectItem
                                          key={certificate.id}
                                          value={certificate.id}
                                        >
                                          {certificate.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                              </form.Field>
                            )}
                          </Field>
                        )}
                      </form.Field>
                    ) : null
                  }
                </form.Subscribe>

                <Collapsible
                  defaultOpen={false}
                  className="rounded-2xl bg-muted p-3"
                >
                  <CollapsibleTrigger className="group flex w-full items-center justify-between text-left">
                    <p className="font-medium text-sm">
                      Redirect & security policy
                    </p>
                    <ChevronDownIcon
                      className="size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
                      aria-hidden="true"
                    />
                  </CollapsibleTrigger>

                  <CollapsibleContent className="flex flex-col gap-3 pt-3">
                    <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
                      <form.Field name="redirectTo">
                        {(field) => (
                          <Field>
                            <FieldLabel htmlFor={field.name}>
                              Redirect target (optional)
                            </FieldLabel>
                            <Input
                              id={field.name}
                              name={field.name}
                              placeholder="https://www.example.com{uri} or /new-path…"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) =>
                                field.handleChange(e.target.value)
                              }
                            />
                            <FieldError errors={field.state.meta.errors} />
                          </Field>
                        )}
                      </form.Field>
                      <form.Field name="redirectStatus">
                        {(field) => (
                          <Field>
                            <FieldLabel>Redirect status</FieldLabel>
                            <Select
                              items={(
                                ["301", "302", "307", "308"] as const
                              ).map((status) => ({
                                value: status,
                                label: status,
                              }))}
                              value={field.state.value}
                              onValueChange={(value) =>
                                field.handleChange(
                                  value as "301" | "302" | "307" | "308",
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(["301", "302", "307", "308"] as const).map(
                                  (status) => (
                                    <SelectItem key={status} value={status}>
                                      {status}
                                    </SelectItem>
                                  ),
                                )}
                              </SelectContent>
                            </Select>
                          </Field>
                        )}
                      </form.Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <form.Field name="forwardAuth.address">
                        {(field) => (
                          <Field>
                            <FieldLabel htmlFor={field.name}>
                              Forward-auth endpoint (optional)
                            </FieldLabel>
                            <Input
                              id={field.name}
                              name={field.name}
                              type="url"
                              placeholder="https://auth.example.com/verify…"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) =>
                                field.handleChange(e.target.value)
                              }
                            />
                            <FieldError errors={field.state.meta.errors} />
                          </Field>
                        )}
                      </form.Field>
                      <form.Field name="forwardAuth.uri">
                        {(field) => (
                          <Field>
                            <FieldLabel htmlFor={field.name}>
                              Auth URI
                            </FieldLabel>
                            <Input
                              id={field.name}
                              name={field.name}
                              placeholder="/verify"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) =>
                                field.handleChange(e.target.value)
                              }
                            />
                            <FieldError errors={field.state.meta.errors} />
                          </Field>
                        )}
                      </form.Field>
                    </div>
                    <form.Field name="forwardAuth.copyHeaders">
                      {(field) => (
                        <Field>
                          <FieldLabel htmlFor={field.name}>
                            Forwarded auth headers (comma separated)
                          </FieldLabel>
                          <Input
                            id={field.name}
                            name={field.name}
                            placeholder="X-User, X-Email…"
                            value={(field.state.value ?? []).join(", ")}
                            onBlur={field.handleBlur}
                            onChange={(e) =>
                              field.handleChange(
                                e.target.value
                                  .split(",")
                                  .map((header) => header.trim())
                                  .filter(Boolean),
                              )
                            }
                          />
                          <FieldError errors={field.state.meta.errors} />
                        </Field>
                      )}
                    </form.Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <form.Field name="basicAuth.username">
                        {(field) => (
                          <Field>
                            <FieldLabel htmlFor={field.name}>
                              Basic-auth username (optional)
                            </FieldLabel>
                            <Input
                              id={field.name}
                              name={field.name}
                              autoComplete="username"
                              placeholder="admin"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) =>
                                field.handleChange(e.target.value)
                              }
                            />
                            <FieldError errors={field.state.meta.errors} />
                          </Field>
                        )}
                      </form.Field>
                      <form.Field name="basicAuth.passwordHash">
                        {(field) => (
                          <Field>
                            <FieldLabel htmlFor={field.name}>
                              Caddy password hash (optional)
                            </FieldLabel>
                            <Input
                              id={field.name}
                              name={field.name}
                              autoComplete="off"
                              spellCheck={false}
                              placeholder="$2a$14$…"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) =>
                                field.handleChange(e.target.value)
                              }
                            />
                            <FieldError errors={field.state.meta.errors} />
                          </Field>
                        )}
                      </form.Field>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <form.Field name="securityHeaders.hsts">
                        {(field) => (
                          <Label className="flex items-center gap-2 text-xs">
                            <Switch
                              checked={field.state.value}
                              onCheckedChange={field.handleChange}
                            />
                            HSTS
                          </Label>
                        )}
                      </form.Field>
                      <form.Field name="securityHeaders.nosniff">
                        {(field) => (
                          <Label className="flex items-center gap-2 text-xs">
                            <Switch
                              checked={field.state.value}
                              onCheckedChange={field.handleChange}
                            />
                            No sniff
                          </Label>
                        )}
                      </form.Field>
                      <form.Field name="securityHeaders.frameDeny">
                        {(field) => (
                          <Label className="flex items-center gap-2 text-xs">
                            <Switch
                              checked={field.state.value}
                              onCheckedChange={field.handleChange}
                            />
                            Frame deny
                          </Label>
                        )}
                      </form.Field>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </FieldGroup>

              <DialogFooter className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDomainDialogOpen(false)}
                >
                  Cancel
                </Button>
                <form.Subscribe
                  selector={(state) => ({
                    canSubmit: state.canSubmit,
                  })}
                >
                  {({ canSubmit }) => (
                    <Button
                      type="submit"
                      disabled={!canSubmit || isUpdatingResource}
                    >
                      {editingDomainIndex !== null
                        ? "Save Changes"
                        : "Link Domain"}
                    </Button>
                  )}
                </form.Subscribe>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </Card>
      <ConfirmActionDialog
        open={pendingDeleteIndex !== null}
        onOpenChange={(open) => !open && setPendingDeleteIndex(null)}
        title="Remove domain mapping?"
        description={
          <>
            This will remove{" "}
            <strong>{domainList[pendingDeleteIndex ?? -1]?.host}</strong> from
            this resource&apos;s routing configuration. This action cannot be
            undone.
          </>
        }
        actionLabel="Remove mapping"
        pending={isUpdatingResource}
        onConfirm={() => {
          if (pendingDeleteIndex !== null) deleteDomain(pendingDeleteIndex);
        }}
      />
    </>
  );
}
