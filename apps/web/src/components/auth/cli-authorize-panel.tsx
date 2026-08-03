"use client";

import type { ApiKeyPreset } from "@upstand/domain";
import { Button } from "@upstand/ui/components/button";
import {
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Label } from "@upstand/ui/components/label";
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
import { authClient } from "@/lib/auth-client";
import { getServerApiUrl } from "@/lib/server-url";

const presets: Array<{
  value: ApiKeyPreset;
  label: string;
  description: string;
}> = [
  {
    value: "read-only",
    label: "Read-only",
    description: "Inspect projects and deployments.",
  },
  {
    value: "deployment",
    label: "Deployment",
    description: "Inspect and operate deployments.",
  },
  {
    value: "operations",
    label: "Operations",
    description: "Manage deployments, backups, and operations.",
  },
  {
    value: "full-access",
    label: "Full access",
    description: "Grant all supported CLI capabilities.",
  },
];

export function CliAuthorizePanel({ userCode }: { userCode: string }) {
  const { data: organizations, isPending } = authClient.useListOrganizations();
  const [organizationId, setOrganizationId] = useState<string>();
  const [preset, setPreset] = useState<ApiKeyPreset>("deployment");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<"approved" | "denied" | null>(null);

  const selectedOrganizationId = organizationId ?? organizations?.[0]?.id;

  async function submit(action: "approve" | "deny") {
    setPending(true);
    try {
      const response = await fetch(
        getServerApiUrl(`/api/cli/device/${action}`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            clientId: "upstand-cli",
            userCode,
            ...(action === "approve"
              ? { organizationId: selectedOrganizationId, preset }
              : {}),
          }),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        if (body.error === "2FA verification required") {
          const returnTo = `${window.location.pathname}${window.location.search}`;
          window.location.href = `/2fa-verify?return_to=${encodeURIComponent(returnTo)}`;
          return;
        }
        throw new Error(body.error || "Unable to process CLI authorization");
      }
      setResult(action === "approve" ? "approved" : "denied");
      toast.success(
        action === "approve" ? "CLI access approved" : "CLI access denied",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to process CLI authorization",
      );
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-3 py-8 text-center">
        <h1 className="font-bold text-xl">
          {result === "approved" ? "CLI access approved" : "CLI access denied"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {result === "approved"
            ? "You can return to your terminal. The Upstand CLI will finish signing in automatically."
            : "The terminal sign-in request was denied."}
        </p>
      </div>
    );
  }

  if (isPending) {
    return <Spinner className="mx-auto my-12" />;
  }

  if (!selectedOrganizationId || !organizations?.length) {
    return (
      <div className="space-y-3 py-8 text-center">
        <h1 className="font-bold text-xl">No organization available</h1>
        <p className="text-muted-foreground text-sm">
          Your account is not a member of an organization that can authorize the
          CLI.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CardHeader className="p-0 text-center">
        <CardTitle>Authorize Upstand CLI</CardTitle>
        <CardDescription>
          The terminal is requesting access for code{" "}
          <span className="font-mono font-semibold text-foreground">
            {userCode}
          </span>
          .
        </CardDescription>
      </CardHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Organization</Label>
          <Select
            items={organizations.map((organization) => ({
              value: organization.id,
              label: organization.name,
            }))}
            value={selectedOrganizationId}
            onValueChange={(value) => value && setOrganizationId(value)}
          >
            <SelectTrigger aria-label="Organization">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {organizations.map((organization) => (
                <SelectItem key={organization.id} value={organization.id}>
                  {organization.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Permission level</Label>
          <Select
            items={presets}
            value={preset}
            onValueChange={(value) => value && setPreset(value as ApiKeyPreset)}
          >
            <SelectTrigger aria-label="Permission level">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {presets.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            {presets.find((item) => item.value === preset)?.description}
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => void submit("deny")}
            disabled={pending}
          >
            Deny
          </Button>
          <Button
            className="flex-1"
            onClick={() => void submit("approve")}
            disabled={pending}
          >
            {pending ? <Spinner /> : "Approve"}
          </Button>
        </div>
      </div>
    </div>
  );
}
