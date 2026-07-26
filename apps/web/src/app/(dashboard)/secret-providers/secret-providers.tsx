"use client";

import {
  CloudIcon,
  Delete02Icon,
  Key01Icon,
  PencilEdit01Icon,
  PlusSignIcon,
  Shield01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@upstand/api/router";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
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
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import {
  DashboardPage,
  DashboardPageHeader,
} from "@/components/dashboard/dashboard-page";
import { PageEmpty } from "@/components/dashboard/page-empty";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import type { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

export const SECRET_PROVIDER_TYPES = [
  {
    key: "vault",
    name: "HashiCorp Vault",
    description: "HashiCorp Vault KV secret engine integration",
  },
  {
    key: "aws-secrets-manager",
    name: "AWS Secrets Manager",
    description: "Amazon Web Services Secrets Manager integration",
  },
  {
    key: "onepassword",
    name: "1Password Connect",
    description: "1Password Connect API integration",
  },
] as const;

type SecretProviderType = "vault" | "aws-secrets-manager" | "onepassword";
type SecretProvider =
  inferRouterOutputs<AppRouter>["secret"]["providers"][number];

function isSecretProviderType(value: string): value is SecretProviderType {
  return (
    value === "vault" ||
    value === "aws-secrets-manager" ||
    value === "onepassword"
  );
}

export default function SecretProviders(_props: {
  session: typeof authClient.$Infer.Session;
}) {
  const organizationState = useRequiredActiveOrganization();
  const orgId = organizationState.organizationId as string;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // General Form States
  const [name, setName] = useState("");
  const [providerType, setProviderType] = useState<SecretProviderType>("vault");

  // Vault Fields
  const [vaultAddress, setVaultAddress] = useState("");
  const [vaultPath, setVaultPath] = useState("");
  const [vaultToken, setVaultToken] = useState("");

  // AWS Fields
  const [awsRegion, setAwsRegion] = useState("");
  const [awsAccessKeyId, setAwsAccessKeyId] = useState("");
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState("");
  const [awsPath, setAwsPath] = useState("");

  // 1Password Fields
  const [onePasswordHost, setOnePasswordHost] = useState("");
  const [onePasswordToken, setOnePasswordToken] = useState("");
  const [onePasswordVaultId, setOnePasswordVaultId] = useState("");
  const [onePasswordItemId, setOnePasswordItemId] = useState("");

  // Delete State
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState("");

  const {
    data: providers,
    isLoading,
    refetch,
  } = useQuery({
    ...trpc.secret.providers.queryOptions({ organizationId: orgId }),
    enabled: organizationState.status === "ready",
  });

  const createMutation = useMutation({
    ...trpc.secret.createProvider.mutationOptions(),
    onSuccess: () => {
      toast.success("Secret provider created successfully");
      setDialogOpen(false);
      resetForm();
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create secret provider");
    },
  });

  const updateMutation = useMutation({
    ...trpc.secret.updateProvider.mutationOptions(),
    onSuccess: () => {
      toast.success("Secret provider updated successfully");
      setDialogOpen(false);
      resetForm();
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update secret provider");
    },
  });

  const deleteMutation = useMutation({
    ...trpc.secret.deleteProvider.mutationOptions(),
    onSuccess: () => {
      toast.success("Secret provider deleted successfully");
      setDeleteOpen(false);
      setDeleteId(null);
      setDeleteName("");
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to delete secret provider");
    },
  });

  const testMutation = useMutation({
    ...trpc.secret.testConnection.mutationOptions(),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(res.message || "Secret provider connection successful!");
      } else {
        toast.error(res.message || "Failed to connect to secret provider");
      }
    },
    onError: (err) => {
      toast.error(err.message || "Failed to test secret provider connection");
    },
  });

  const buildProviderConfiguration = (): Record<string, string> => {
    const config: Record<string, string> = {};
    if (providerType === "vault") {
      if (vaultAddress.trim()) config.address = vaultAddress.trim();
      if (vaultPath.trim()) config.path = vaultPath.trim();
      if (vaultToken.trim()) config.token = vaultToken.trim();
    } else if (providerType === "aws-secrets-manager") {
      if (awsRegion.trim()) config.region = awsRegion.trim();
      if (awsAccessKeyId.trim()) config.accessKeyId = awsAccessKeyId.trim();
      if (awsSecretAccessKey.trim())
        config.secretAccessKey = awsSecretAccessKey.trim();
      if (awsPath.trim()) config.path = awsPath.trim();
    } else if (providerType === "onepassword") {
      if (onePasswordHost.trim()) config.connectHost = onePasswordHost.trim();
      if (onePasswordToken.trim())
        config.connectToken = onePasswordToken.trim();
      if (onePasswordVaultId.trim()) config.vaultId = onePasswordVaultId.trim();
      if (onePasswordItemId.trim()) config.itemId = onePasswordItemId.trim();
    }
    return config;
  };

  const handleTestConnection = () => {
    const config = buildProviderConfiguration();

    testMutation.mutate({
      provider: providerType,
      configuration: config,
    });
  };

  const resetForm = () => {
    setEditId(null);
    setName("");
    setProviderType("vault");
    setVaultAddress("");
    setVaultPath("");
    setVaultToken("");
    setAwsRegion("");
    setAwsAccessKeyId("");
    setAwsSecretAccessKey("");
    setAwsPath("");
    setOnePasswordHost("");
    setOnePasswordToken("");
    setOnePasswordVaultId("");
    setOnePasswordItemId("");
  };

  const handleOpenCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const handleOpenEdit = (prov: SecretProvider): void => {
    setEditId(prov.id);
    setName(prov.name);
    if (isSecretProviderType(prov.provider)) setProviderType(prov.provider);
    setVaultAddress("");
    setVaultPath("");
    setVaultToken("");
    setAwsRegion("");
    setAwsAccessKeyId("");
    setAwsSecretAccessKey("");
    setAwsPath("");
    setOnePasswordHost("");
    setOnePasswordToken("");
    setOnePasswordVaultId("");
    setOnePasswordItemId("");
    setDialogOpen(true);
  };

  const handleToggleEnabled = (prov: SecretProvider): void => {
    updateMutation.mutate({
      id: prov.id,
      enabled: !prov.enabled,
    });
  };

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Please enter a name for the secret provider");
      return;
    }

    const config = buildProviderConfiguration();

    // Verify connection before saving
    if (Object.keys(config).length > 0 || !editId) {
      try {
        const testRes = await testMutation.mutateAsync({
          provider: providerType,
          configuration: config,
        });
        if (!testRes.success) {
          toast.error(
            `Connection test failed: ${testRes.message}. Please verify settings before saving.`,
          );
          return;
        }
      } catch (error: unknown) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to verify provider connection",
        );
        return;
      }
    }

    if (editId) {
      updateMutation.mutate({
        id: editId,
        name: name.trim(),
        configuration: Object.keys(config).length > 0 ? config : undefined,
      });
    } else {
      createMutation.mutate({
        organizationId: orgId,
        name: name.trim(),
        provider: providerType,
        configuration: config,
      });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <DashboardPage>
      <DashboardPageHeader
        title="Secret Providers"
        description="Integrate external secret managers (Vault, AWS Secrets Manager, 1Password) to sync, version, and rotate credentials across your environments and workloads."
        actions={
          <Button onClick={handleOpenCreate} size="sm">
            <HugeiconsIcon icon={PlusSignIcon} className="mr-1.5 size-4" />
            Add Secret Provider
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner />
        </div>
      ) : !providers || providers.length === 0 ? (
        <PageEmpty
          icon={Key01Icon}
          title="No Secret Providers Configured"
          description="Connect HashiCorp Vault, AWS Secrets Manager, or 1Password Connect to automatically sync and rotate sensitive environment variables."
          action={
            <Button onClick={handleOpenCreate} size="sm">
              <HugeiconsIcon icon={PlusSignIcon} className="mr-1.5 size-4" />
              Add Secret Provider
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((prov) => {
            const providerInfo = SECRET_PROVIDER_TYPES.find(
              (p) => p.key === prov.provider,
            );
            return (
              <Card
                key={prov.id}
                className="relative flex flex-col justify-between"
              >
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon
                        icon={
                          prov.provider === "vault"
                            ? Key01Icon
                            : prov.provider === "aws-secrets-manager"
                              ? CloudIcon
                              : Shield01Icon
                        }
                        className="size-5 text-primary"
                      />
                      <CardTitle className="font-semibold text-base">
                        {prov.name}
                      </CardTitle>
                    </div>
                    <Badge variant={prov.enabled ? "default" : "secondary"}>
                      {prov.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    {providerInfo?.name || prov.provider}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="text-muted-foreground text-xs">
                    Created {new Date(prov.createdAt).toLocaleDateString()}
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 flex-1"
                      onClick={() => handleToggleEnabled(prov)}
                    >
                      {prov.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2.5"
                      onClick={() => handleOpenEdit(prov)}
                    >
                      <HugeiconsIcon
                        icon={PencilEdit01Icon}
                        className="size-4"
                      />
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-8 px-2.5"
                      onClick={() => {
                        setDeleteId(prov.id);
                        setDeleteName(prov.name);
                        setDeleteOpen(true);
                      }}
                    >
                      <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add / Edit Secret Provider Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>
                {editId ? "Edit Secret Provider" : "Add Secret Provider"}
              </DialogTitle>
              <DialogDescription>
                Configure credentials for external secret managers. Sensitive
                tokens are encrypted at rest using AES-GCM.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="provider-name">Provider Name</Label>
                <Input
                  id="provider-name"
                  placeholder="e.g., Production Vault, AWS Staging Secrets"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="provider-type">Provider Type</Label>
                <Select
                  value={providerType}
                  onValueChange={(val) => {
                    if (val) setProviderType(val as SecretProviderType);
                  }}
                  disabled={!!editId}
                >
                  <SelectTrigger id="provider-type" className="w-full">
                    <SelectValue placeholder="Select secret provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {SECRET_PROVIDER_TYPES.map((pt) => (
                      <SelectItem key={pt.key} value={pt.key}>
                        {pt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Dynamic Provider Form Fields */}
              {providerType === "vault" && (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="vault-address">Vault Address</Label>
                    <Input
                      id="vault-address"
                      placeholder="https://vault.example.com:8200"
                      value={vaultAddress}
                      onChange={(e) => setVaultAddress(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="vault-path">KV Secret Path</Label>
                    <Input
                      id="vault-path"
                      placeholder="e.g., secret/data/myapp"
                      value={vaultPath}
                      onChange={(e) => setVaultPath(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="vault-token">Vault Token</Label>
                    <Input
                      id="vault-token"
                      type="password"
                      placeholder={
                        editId
                          ? "Leave blank to keep existing token"
                          : "hvs.xxxxxxxxxxxxxxxx"
                      }
                      value={vaultToken}
                      onChange={(e) => setVaultToken(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {providerType === "aws-secrets-manager" && (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="aws-region">AWS Region</Label>
                    <Input
                      id="aws-region"
                      placeholder="us-east-1"
                      value={awsRegion}
                      onChange={(e) => setAwsRegion(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="aws-access-key">Access Key ID</Label>
                    <Input
                      id="aws-access-key"
                      placeholder="AKIAXXXXXXXXXXXXXXXX"
                      value={awsAccessKeyId}
                      onChange={(e) => setAwsAccessKeyId(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="aws-secret-key">Secret Access Key</Label>
                    <Input
                      id="aws-secret-key"
                      type="password"
                      placeholder={
                        editId
                          ? "Leave blank to keep existing key"
                          : "Secret Access Key"
                      }
                      value={awsSecretAccessKey}
                      onChange={(e) => setAwsSecretAccessKey(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="aws-path">Secret ID / Path</Label>
                    <Input
                      id="aws-path"
                      placeholder="e.g., production/app/secrets"
                      value={awsPath}
                      onChange={(e) => setAwsPath(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {providerType === "onepassword" && (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="op-host">1Password Connect Host</Label>
                    <Input
                      id="op-host"
                      placeholder="https://onepassword-connect.example.com"
                      value={onePasswordHost}
                      onChange={(e) => setOnePasswordHost(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="op-token">Connect Token</Label>
                    <Input
                      id="op-token"
                      type="password"
                      placeholder={
                        editId
                          ? "Leave blank to keep existing token"
                          : "Connect Token"
                      }
                      value={onePasswordToken}
                      onChange={(e) => setOnePasswordToken(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="op-vault-id">Vault ID</Label>
                    <Input
                      id="op-vault-id"
                      placeholder="1Password Vault UUID"
                      value={onePasswordVaultId}
                      onChange={(e) => setOnePasswordVaultId(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="op-item-id">Item ID</Label>
                    <Input
                      id="op-item-id"
                      placeholder="1Password Item UUID"
                      value={onePasswordItemId}
                      onChange={(e) => setOnePasswordItemId(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="flex items-center justify-between sm:justify-between">
              <Button
                type="button"
                variant="secondary"
                onClick={handleTestConnection}
                disabled={testMutation.isPending || isSaving}
              >
                {testMutation.isPending && (
                  <Spinner className="mr-1.5 size-4" />
                )}
                Test Connection
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={isSaving || testMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSaving || testMutation.isPending}
                >
                  {isSaving && <Spinner className="mr-1.5 size-4" />}
                  {editId ? "Save Changes" : "Create Secret Provider"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Provider Confirmation */}
      <ConfirmActionDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete "${deleteName}"?`}
        description="Are you sure you want to delete this secret provider integration? Workloads relying on sync schedules for this provider will no longer fetch external updates."
        actionLabel="Delete Secret Provider"
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate({ id: deleteId });
        }}
      />
    </DashboardPage>
  );
}
