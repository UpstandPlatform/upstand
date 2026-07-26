"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  API_KEY_SCOPE_ACTIONS,
  type ApiKeyPreset,
  type Capability,
} from "@upstand/domain";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@upstand/ui/components/alert";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Checkbox } from "@upstand/ui/components/checkbox";
import { Input } from "@upstand/ui/components/input";
import { Label } from "@upstand/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Spinner } from "@upstand/ui/components/spinner";
import { cn } from "@upstand/ui/lib/utils";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  Copy,
  ShieldCheck,
  Trash2,
} from "@/components/huge-icons";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { copyText } from "@/lib/browser";
import { trpc } from "@/utils/trpc";

const PRESETS: Array<{
  value: ApiKeyPreset;
  label: string;
  description: string;
}> = [
  {
    value: "read-only",
    label: "Read-only",
    description: "Inspect organization resources and status.",
  },
  {
    value: "deployment",
    label: "Deployment",
    description: "Read and operate deployment workflows.",
  },
  {
    value: "operations",
    label: "Operations",
    description: "Manage deployments, backups, and Swarm operations.",
  },
  {
    value: "mcp-read-only",
    label: "MCP read-only",
    description: "Use read-only MCP tools.",
  },
  {
    value: "full-access",
    label: "Full access",
    description: "All supported API and MCP capabilities.",
  },
];

export function ApiKeysPanel() {
  const organizationState = useRequiredActiveOrganization();
  const organizationId = organizationState.organizationId as string;
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<ApiKeyPreset>("read-only");
  const [expiresInDays, setExpiresInDays] = useState("90");
  const [advanced, setAdvanced] = useState(false);
  const [selectedPermissions, setSelectedPermissions] = useState<Capability[]>(
    [],
  );
  const [secret, setSecret] = useState<string | null>(null);

  const keys = useQuery({
    ...trpc.apiKey.list.queryOptions({ organizationId }),
    enabled: organizationState.status === "ready",
  });
  const create = useMutation({
    ...trpc.apiKey.create.mutationOptions(),
    onSuccess: (result) => {
      setSecret(result.secret);
      setName("");
      void keys.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const revoke = useMutation({
    ...trpc.apiKey.revoke.mutationOptions(),
    onSuccess: () => {
      toast.success("API key revoked");
      void keys.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const [togglingKeyId, setTogglingKeyId] = useState<string | null>(null);

  const updateKey = useMutation({
    ...trpc.apiKey.update.mutationOptions(),
    onSuccess: (data) => {
      toast.success(data.enabled ? "API key activated" : "API key deactivated");
      setTogglingKeyId(null);
      void keys.refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update API key");
      setTogglingKeyId(null);
    },
  });

  const permissionSelection = useMemo(
    () => ({
      upstand: selectedPermissions,
      mcp: preset === "mcp-read-only" ? ["read"] : [],
    }),
    [preset, selectedPermissions],
  );

  function togglePermission(permission: Capability, checked: boolean) {
    setSelectedPermissions((current) =>
      checked
        ? [...new Set([...current, permission])]
        : current.filter((item) => item !== permission),
    );
  }

  function createKey() {
    if (!organizationId || !name.trim()) return;
    create.mutate({
      organizationId,
      name: name.trim(),
      preset: advanced ? undefined : preset,
      permissions: advanced ? permissionSelection : undefined,
      expiresInDays: expiresInDays ? Number(expiresInDays) : null,
      rateLimitEnabled: true,
      rateLimitTimeWindowMs: 3_600_000,
      rateLimitMax: 1_000,
    });
  }

  if (!organizationId) {
    return (
      <p className="text-muted-foreground text-sm">
        Select a workspace to manage API keys.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Create an API key</CardTitle>
          <CardDescription className="text-xs">
            Secrets are shown once, hashed by Better Auth, and rate limited
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-name" className="font-medium text-xs">
                Name
              </Label>
              <Input
                id="key-name"
                name="name"
                autoComplete="off"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="CI deployment key"
                className="h-9 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-expiration" className="font-medium text-xs">
                Expiration (days)
              </Label>
              <Input
                id="key-expiration"
                name="expiresInDays"
                type="number"
                autoComplete="off"
                min={1}
                max={365}
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
                className="h-9 text-xs"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="key-preset" className="font-medium text-xs">
              Permission preset
            </Label>
            <Select
              items={PRESETS}
              value={preset}
              disabled={advanced}
              onValueChange={(value) => {
                if (value) setPreset(value as ApiKeyPreset);
              }}
            >
              <SelectTrigger
                id="key-preset"
                className="h-9 w-full text-xs"
                aria-label="Permission preset"
              >
                <SelectValue placeholder="Select a permission preset" />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map((item) => (
                  <SelectItem
                    key={item.value}
                    value={item.value}
                    className="text-xs"
                  >
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {PRESETS.find((item) => item.value === preset)?.description}
            </p>
          </div>
          <Label className="flex cursor-pointer items-center gap-2 font-medium text-xs">
            <Checkbox
              checked={advanced}
              onCheckedChange={(checked) => setAdvanced(checked === true)}
            />
            Use advanced permissions
          </Label>
          {advanced ? (
            <div className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-2">
              {API_KEY_SCOPE_ACTIONS.map((permission) => (
                <Label
                  key={permission}
                  className="flex cursor-pointer items-center gap-2 font-medium text-xs"
                >
                  <Checkbox
                    checked={selectedPermissions.includes(permission)}
                    onCheckedChange={(checked) =>
                      togglePermission(permission, checked === true)
                    }
                  />
                  {permission}
                </Label>
              ))}
            </div>
          ) : null}
          <div className="flex justify-end pt-2">
            <Button
              size="sm"
              onClick={createKey}
              disabled={!name.trim() || create.isPending}
            >
              {create.isPending ? <Spinner data-icon="inline-start" /> : null}
              {create.isPending ? "Creating…" : "Create API key"}
            </Button>
          </div>
          {secret ? (
            <Alert variant="warning">
              <AlertTriangleIcon />
              <AlertTitle>
                Copy this secret now. It cannot be recovered.
              </AlertTitle>
              <AlertDescription className="pt-2">
                <div className="flex items-center gap-2 rounded-2xl bg-muted/60 p-1.5 pl-3">
                  <code className="min-w-0 flex-1 select-all truncate font-mono text-foreground text-xs">
                    {secret}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void copyText(secret)
                        .then(() => toast.success("Secret copied"))
                        .catch(() => toast.error("Failed to copy secret"));
                    }}
                    className="shrink-0 gap-1.5"
                  >
                    <Copy className="size-3.5" />
                    <span>Copy</span>
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Organization keys</CardTitle>
          <CardDescription className="text-xs">
            Revoked and expired keys cannot be used, even if cached clients
            retry.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          {keys.data?.apiKeys.map((key) => (
            <div
              key={key.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b p-3 text-xs"
            >
              <div className="mr-auto min-w-0">
                <p className="font-semibold text-foreground">
                  {key.name || "Unnamed key"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {key.start || key.prefix || "key"} · expires{" "}
                  {key.expiresAt
                    ? new Date(key.expiresAt).toLocaleDateString()
                    : "never"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="xs"
                  variant={key.enabled ? "outline" : "secondary"}
                  onClick={() => {
                    setTogglingKeyId(key.id);
                    updateKey.mutate({
                      organizationId,
                      keyId: key.id,
                      enabled: !key.enabled,
                    });
                  }}
                  disabled={updateKey.isPending && togglingKeyId === key.id}
                  className="gap-1.5 font-medium text-xs transition-colors"
                  title={
                    key.enabled
                      ? "Click to deactivate API key"
                      : "Click to activate API key"
                  }
                >
                  {updateKey.isPending && togglingKeyId === key.id ? (
                    <Spinner className="size-3" />
                  ) : (
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        key.enabled
                          ? "bg-emerald-500"
                          : "bg-muted-foreground/50",
                      )}
                    />
                  )}
                  <span>{key.enabled ? "Active" : "Deactivated"}</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    revoke.mutate({ organizationId, keyId: key.id })
                  }
                  disabled={revoke.isPending}
                  className="text-destructive hover:text-destructive"
                >
                  {revoke.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Trash2 data-icon="inline-start" />
                  )}
                  Revoke
                </Button>
              </div>
            </div>
          ))}
          {!keys.data?.apiKeys.length ? (
            <p className="py-2 text-center text-muted-foreground text-xs">
              No API keys yet.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 px-1 text-muted-foreground text-xs">
        <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
        <span>Organization keys never create browser sessions.</span>
      </div>
    </div>
  );
}
