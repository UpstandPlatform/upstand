"use client";

import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@upstand/ui/components/alert";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Spinner } from "@upstand/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";
import { Code, Copy, KeyRound, ShieldCheck } from "@/components/huge-icons";
import { CodeBlock } from "@/components/shared/code-block";
import { useSystemConfig } from "@/hooks/use-system-config";
import { copyText } from "@/lib/browser";
import { getServerApiUrl } from "@/lib/server-url";
import { trpc } from "@/utils/trpc";
import { createMcpClientConfigTabs } from "./mcp-client-config";

type Props = {
  organizationId: string;
};

const EXPIRATION_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "365 days" },
  { value: "never", label: "No expiration" },
];

function getRuntimeLabel(mode: string): string {
  switch (mode) {
    case "desktop":
      return "Desktop local";
    case "cloud":
      return "Cloud";
    default:
      return "Self-hosted";
  }
}

export function McpSettingsSection({ organizationId }: Props) {
  const { platformMode } = useSystemConfig();
  const [expiration, setExpiration] = useState("90");
  const [secret, setSecret] = useState<string | null>(null);
  const endpoint = getServerApiUrl("/api/mcp");
  const tabs = secret ? createMcpClientConfigTabs(endpoint, secret) : [];

  const createKey = useMutation({
    ...trpc.apiKey.create.mutationOptions(),
    onSuccess: ({ secret: createdSecret }) => {
      setSecret(createdSecret);
      toast.success("MCP configuration is ready");
    },
    onError: (error) =>
      toast.error(error.message || "Unable to create MCP key"),
  });

  function createMcpKey() {
    createKey.mutate({
      organizationId,
      name: "UpGal MCP client",
      preset: "mcp-read-only",
      expiresInDays: expiration === "never" ? null : Number(expiration),
      rateLimitEnabled: true,
      rateLimitTimeWindowMs: 3_600_000,
      rateLimitMax: 1_000,
    });
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Code className="size-4" />
            </div>
            <div>
              <CardTitle className="text-sm">MCP server</CardTitle>
              <CardDescription className="text-xs">
                Connect Codex, Claude Code, Gemini, Copilot, Cursor, and other
                HTTP MCP clients to UpGal.
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {getRuntimeLabel(platformMode)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Alert className="border-primary/20 bg-primary/5">
          <ShieldCheck />
          <AlertTitle className="text-xs">Read-only by default</AlertTitle>
          <AlertDescription className="text-xs">
            Create a scoped MCP key for your coding tool. Read operations are
            available to the client; write operations remain behind UpGal
            approval in the dashboard.
          </AlertDescription>
        </Alert>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-xs">MCP endpoint</p>
              <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                {endpoint}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => {
                void copyText(endpoint)
                  .then(() => toast.success("MCP endpoint copied"))
                  .catch(() => toast.error("Failed to copy MCP endpoint"));
              }}
            >
              <Copy data-icon="inline-start" />
              Copy endpoint
            </Button>
          </div>
        </div>

        {!secret ? (
          <div className="rounded-lg border border-dashed p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-sm">
                  Generate client configuration
                </p>
                <p className="mt-1 max-w-xl text-muted-foreground text-xs">
                  The read-only token is shown once and never stored in the
                  browser. Generate a new key if you lose the configuration.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Select
                  items={EXPIRATION_OPTIONS}
                  value={expiration}
                  onValueChange={(value) => {
                    if (value) setExpiration(value);
                  }}
                >
                  <SelectTrigger
                    className="h-8 w-32 text-xs"
                    aria-label="MCP key expiration"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRATION_OPTIONS.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        className="text-xs"
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  onClick={createMcpKey}
                  disabled={createKey.isPending || !organizationId}
                >
                  {createKey.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <KeyRound data-icon="inline-start" />
                  )}
                  {createKey.isPending ? "Generating…" : "Generate key"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-xs">Client configuration</p>
                <p className="text-[11px] text-muted-foreground">
                  Copy the matching tab into your coding tool. The token is
                  scoped to this workspace and key expiration.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => setSecret(null)}
              >
                Hide configuration
              </Button>
            </div>
            <CodeBlock
              tabs={tabs}
              showDownload={false}
              className="rounded-lg"
            />
          </div>
        )}

        <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          <span>
            MCP uses the same organization and capability boundaries on desktop
            local, cloud, and self-hosted runtimes. API keys do not create
            browser sessions.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
