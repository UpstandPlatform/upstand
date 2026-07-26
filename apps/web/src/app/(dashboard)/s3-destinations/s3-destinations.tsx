"use client";

import {
  CloudIcon,
  Database01Icon,
  Delete02Icon,
  PencilEdit01Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@upstand/api/router";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
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

export const S3_PROVIDERS: Array<{
  key: string;
  name: string;
}> = [
  { key: "AWS", name: "Amazon Web Services (AWS) S3" },
  { key: "Alibaba", name: "Alibaba Cloud Object Storage System (OSS)" },
  { key: "ArvanCloud", name: "Arvan Cloud Object Storage (AOS)" },
  { key: "Ceph", name: "Ceph Object Storage" },
  {
    key: "ChinaMobile",
    name: "China Mobile Ecloud Elastic Object Storage (EOS)",
  },
  { key: "Cloudflare", name: "Cloudflare R2 Storage" },
  { key: "DigitalOcean", name: "DigitalOcean Spaces" },
  { key: "Dreamhost", name: "Dreamhost DreamObjects" },
  { key: "GCS", name: "Google Cloud Storage" },
  { key: "HuaweiOBS", name: "Huawei Object Storage Service" },
  { key: "IBMCOS", name: "IBM COS S3" },
  { key: "IDrive", name: "IDrive e2" },
  { key: "IONOS", name: "IONOS Cloud" },
  { key: "LyveCloud", name: "Seagate Lyve Cloud" },
  { key: "Leviia", name: "Leviia Object Storage" },
  { key: "Liara", name: "Liara Object Storage" },
  { key: "Linode", name: "Linode Object Storage" },
  { key: "Magalu", name: "Magalu Object Storage" },
  { key: "Minio", name: "Minio Object Storage" },
  { key: "Netease", name: "Netease Object Storage (NOS)" },
  { key: "Petabox", name: "Petabox Object Storage" },
  { key: "RackCorp", name: "RackCorp Object Storage" },
  { key: "Rclone", name: "Rclone S3 Server" },
  { key: "Scaleway", name: "Scaleway Object Storage" },
  { key: "SeaweedFS", name: "SeaweedFS S3" },
  { key: "StackPath", name: "StackPath Object Storage" },
  { key: "Storj", name: "Storj (S3 Compatible Gateway)" },
  { key: "Synology", name: "Synology C2 Object Storage" },
  { key: "TencentCOS", name: "Tencent Cloud Object Storage (COS)" },
  { key: "Wasabi", name: "Wasabi Object Storage" },
  { key: "Qiniu", name: "Qiniu Object Storage (Kodo)" },
  { key: "Other", name: "Any other S3 compatible provider" },
];
type S3Destination =
  inferRouterOutputs<AppRouter>["s3Destination"]["list"][number];
type Certificate = inferRouterOutputs<AppRouter>["certificate"]["list"][number];

export default function S3Destinations(_props: {
  session: typeof authClient.$Infer.Session;
}) {
  const organizationState = useRequiredActiveOrganization();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [bucket, setBucket] = useState("");
  const [region, setRegion] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [certificateId, setCertificateId] = useState<string>("none");
  const [additionalFlags, setAdditionalFlags] = useState<string[]>([]);

  // Delete states
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState("");

  const orgId = organizationState.organizationId as string;

  const {
    data: destinations,
    isLoading: loadingDestinations,
    refetch,
  } = useQuery({
    ...trpc.s3Destination.list.queryOptions({ organizationId: orgId }),
    enabled: organizationState.status === "ready",
  });

  const { data: certificates = [] } = useQuery({
    ...trpc.certificate.list.queryOptions({ organizationId: orgId }),
    enabled: organizationState.status === "ready" && Boolean(orgId),
  });

  const createMutation = useMutation({
    ...trpc.s3Destination.create.mutationOptions(),
    onSuccess: () => {
      toast.success("S3 Destination created successfully");
      setDialogOpen(false);
      resetForm();
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create S3 Destination");
    },
  });

  const updateMutation = useMutation({
    ...trpc.s3Destination.update.mutationOptions(),
    onSuccess: () => {
      toast.success("S3 Destination updated successfully");
      setDialogOpen(false);
      resetForm();
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update S3 Destination");
    },
  });

  const deleteMutation = useMutation({
    ...trpc.s3Destination.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("S3 Destination deleted successfully");
      setDeleteId(null);
      setDeleteOpen(false);
      refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to delete S3 Destination");
    },
  });

  const testConnectionMutation = useMutation({
    ...trpc.s3Destination.testConnection.mutationOptions(),
    onSuccess: () => {
      toast.success("Connection test successful!");
    },
    onError: (err) => {
      toast.error("Connection test failed", {
        description: err.message,
      });
    },
  });

  const resetForm = () => {
    setEditId(null);
    setName("");
    setProvider("");
    setAccessKeyId("");
    setSecretAccessKey("");
    setBucket("");
    setRegion("");
    setEndpoint("");
    setCertificateId("none");
    setAdditionalFlags([]);
  };

  const handleOpenAdd = () => {
    resetForm();
    setDialogOpen(true);
  };

  const handleOpenEdit = (dest: S3Destination): void => {
    setEditId(dest.id);
    setName(dest.name);
    setProvider(dest.provider);
    setAccessKeyId("");
    setSecretAccessKey("");
    setBucket(dest.bucket);
    setRegion(dest.region);
    setEndpoint(dest.endpoint);
    setCertificateId(dest.certificateId || "none");
    try {
      setAdditionalFlags(JSON.parse(dest.additionalFlags || "[]"));
    } catch {
      setAdditionalFlags([]);
    }
    setDialogOpen(true);
  };

  const handleOpenDelete = (id: string, name: string) => {
    setDeleteId(id);
    setDeleteName(name);
    setDeleteOpen(true);
  };

  const handleAddFlag = () => {
    setAdditionalFlags([...additionalFlags, ""]);
  };

  const handleUpdateFlag = (index: number, val: string) => {
    const next = [...additionalFlags];
    next[index] = val;
    setAdditionalFlags(next);
  };

  const handleRemoveFlag = (index: number) => {
    const next = additionalFlags.filter((_, idx) => idx !== index);
    setAdditionalFlags(next);
  };

  const handleAddSsePreset = (preset: "AES256" | "KMS" | "C") => {
    const existing = additionalFlags.filter(
      (f) => !/^--s3-(server-side-encryption|sse-)/i.test(f.trim()),
    );
    if (preset === "AES256") {
      setAdditionalFlags([...existing, "--s3-server-side-encryption=AES256"]);
    } else if (preset === "KMS") {
      setAdditionalFlags([
        ...existing,
        "--s3-server-side-encryption=aws:kms",
        "--s3-sse-kms-key-id=arn:aws:kms:region:account:key/key-id",
      ]);
    } else if (preset === "C") {
      setAdditionalFlags([
        ...existing,
        "--s3-sse-customer-algorithm=AES256",
        "--s3-sse-customer-key=YOUR_BASE64_ENCODED_32BYTE_KEY",
      ]);
    }
  };

  const handleTestConnection = () => {
    if (
      !orgId ||
      !provider ||
      !accessKeyId ||
      !secretAccessKey ||
      !bucket ||
      !endpoint
    ) {
      toast.error(
        "Please fill in all required fields (Provider, Access Key Id, Secret Access Key, Bucket, Endpoint) to test connection.",
      );
      return;
    }
    testConnectionMutation.mutate({
      organizationId: orgId,
      provider,
      accessKeyId,
      secretAccessKey,
      bucket,
      region,
      endpoint,
      certificateId: certificateId !== "none" ? certificateId : undefined,
      additionalFlags: additionalFlags.filter((f) => f.trim() !== ""),
    });
  };

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!orgId) {
      toast.error("No active organization selected");
      return;
    }

    const payload = {
      organizationId: orgId,
      name: name.trim(),
      provider,
      accessKeyId: accessKeyId.trim(),
      secretAccessKey: secretAccessKey.trim(),
      bucket: bucket.trim(),
      region: region.trim(),
      endpoint: endpoint.trim(),
      certificateId: certificateId !== "none" ? certificateId : null,
      additionalFlags: additionalFlags.filter((f) => f.trim() !== ""),
    };

    if (editId) {
      updateMutation.mutate({
        id: editId,
        ...payload,
      });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleDeleteSubmit = () => {
    if (!deleteId) return;
    deleteMutation.mutate({ id: deleteId });
  };

  return (
    <DashboardPage>
      {/* Header */}
      <DashboardPageHeader
        title="S3 Storage"
        description="Manage your S3-compatible destinations. These providers will be used to store backups of your resources."
        icon={
          <HugeiconsIcon icon={CloudIcon} className="size-6 text-primary" />
        }
        actions={
          <Button onClick={handleOpenAdd} className="gap-2 font-medium">
            <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
            Add Destination
          </Button>
        }
      />

      {/* Main List */}
      {loadingDestinations ? (
        <div className="flex min-h-60 items-center justify-center">
          <Spinner className="size-8" />
        </div>
      ) : !orgId ? (
        <div className="py-12 text-center text-muted-foreground">
          Please select an organization to view S3 Storage destinations.
        </div>
      ) : destinations && destinations.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {destinations.map((dest) => {
            const providerDetails = S3_PROVIDERS.find(
              (p) => p.key === dest.provider,
            );
            const flags = JSON.parse(dest.additionalFlags || "[]") as string[];

            return (
              <Card
                key={dest.id}
                className="border border-border/40 bg-card/30 transition-all duration-300 hover:border-primary/45"
              >
                <CardHeader className="flex flex-row items-start justify-between pb-3">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 font-bold text-base">
                      {dest.name}
                      <Badge
                        variant="outline"
                        className="text-[10px] capitalize"
                      >
                        {providerDetails?.name || dest.provider}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="space-y-1 pt-1 text-muted-foreground text-xs">
                      <div>
                        <span className="font-medium text-foreground/80">
                          Bucket:
                        </span>{" "}
                        {dest.bucket}
                      </div>
                      <div>
                        <span className="font-medium text-foreground/80">
                          Endpoint:
                        </span>{" "}
                        {dest.endpoint}
                      </div>
                      {dest.region && (
                        <div>
                          <span className="font-medium text-foreground/80">
                            Region:
                          </span>{" "}
                          {dest.region}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1 pt-1">
                        {dest.certificateId && (
                          <Badge
                            variant="secondary"
                            className="bg-blue-500/10 text-[10px] text-blue-600 dark:text-blue-400"
                          >
                            Custom CA
                          </Badge>
                        )}
                        {flags.some((f) =>
                          /^--s3-(server-side-encryption|sse-)/i.test(f),
                        ) && (
                          <Badge
                            variant="secondary"
                            className="bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400"
                          >
                            Encrypted (SSE)
                          </Badge>
                        )}
                      </div>
                      {flags.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {flags.map((f, i) => (
                            <Badge
                              key={i}
                              variant="secondary"
                              className="px-1.5 py-0 font-mono text-[9px]"
                            >
                              {f}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardDescription>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleOpenEdit(dest)}
                      className="size-8 text-muted-foreground hover:bg-muted/10 hover:text-foreground"
                    >
                      <HugeiconsIcon
                        icon={PencilEdit01Icon}
                        className="size-4"
                      />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleOpenDelete(dest.id, dest.name)}
                      className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                    </Button>
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      ) : (
        <PageEmpty
          icon={Database01Icon}
          title="No S3 destinations yet"
          description="Add an S3-compatible destination such as AWS S3, Cloudflare R2, Wasabi, or DigitalOcean Spaces for backups."
          action={
            <Button onClick={handleOpenAdd}>
              <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
              Add destination
            </Button>
          }
        />
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="shrink-0 border-border/40 border-b p-6">
            <DialogTitle>{editId ? "Update" : "Add"} Destination</DialogTitle>
            <DialogDescription>
              In this section, you can configure and add new destinations for
              your backups. Please ensure that you provide the correct
              information to guarantee secure and efficient storage.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={handleSubmit}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <div className="flex-1 space-y-4 overflow-y-auto px-6 pt-6 pb-6">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  required
                  placeholder="S3 Bucket"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="provider">Provider</Label>
                <Select
                  items={S3_PROVIDERS.map((p) => ({
                    value: p.key,
                    label: p.name,
                  }))}
                  value={provider}
                  onValueChange={(val) => setProvider(val || "")}
                >
                  <SelectTrigger className="w-full" id="provider">
                    <SelectValue placeholder="Select a S3 Provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {S3_PROVIDERS.map((p) => (
                      <SelectItem key={p.key} value={p.key}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="accessKeyId">Access Key Id</Label>
                <Input
                  id="accessKeyId"
                  required={!editId}
                  placeholder={
                    editId ? "Leave blank to keep existing" : "xcas41dasde"
                  }
                  value={accessKeyId}
                  onChange={(e) => setAccessKeyId(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="secretAccessKey">Secret Access Key</Label>
                <Input
                  id="secretAccessKey"
                  required={!editId}
                  type="password"
                  placeholder={
                    editId ? "Leave blank to keep existing" : "asd123asdasw"
                  }
                  value={secretAccessKey}
                  onChange={(e) => setSecretAccessKey(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="bucket">Bucket</Label>
                  <Input
                    id="bucket"
                    required
                    placeholder="dokploy-bucket"
                    value={bucket}
                    onChange={(e) => setBucket(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="region">Region</Label>
                  <Input
                    id="region"
                    placeholder="us-east-1"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="endpoint">Endpoint</Label>
                <Input
                  id="endpoint"
                  required
                  placeholder="https://us.bucket.aws/s3"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                />
              </div>

              {/* CA Certificate */}
              <div className="space-y-2">
                <Label htmlFor="caCertificate">CA Certificate (Optional)</Label>
                <Select
                  value={certificateId}
                  onValueChange={(value) => {
                    setCertificateId(value ?? "none");
                  }}
                >
                  <SelectTrigger id="caCertificate" className="w-full">
                    <SelectValue placeholder="Select a CA certificate (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      None (Default System CA)
                    </SelectItem>
                    {certificates.map((cert: Certificate) => (
                      <SelectItem key={cert.id} value={cert.id}>
                        {cert.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Select a custom CA certificate to pass via{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                    --ca-cert
                  </code>{" "}
                  for self-signed MinIO or private S3 endpoints.
                </p>
              </div>

              {/* Server-Side Encryption (SSE) Helpers */}
              <div className="space-y-2 border-border/40 border-t pt-2">
                <Label className="font-semibold text-muted-foreground text-xs">
                  Server-Side Encryption (SSE) Presets
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleAddSsePreset("AES256")}
                    className="h-7 text-xs"
                  >
                    + SSE-S3 (AES256)
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleAddSsePreset("KMS")}
                    className="h-7 text-xs"
                  >
                    + SSE-KMS (AWS KMS)
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleAddSsePreset("C")}
                    className="h-7 text-xs"
                  >
                    + SSE-C (Customer Key)
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!additionalFlags.includes("--no-check-certificate")) {
                        setAdditionalFlags([
                          ...additionalFlags,
                          "--no-check-certificate",
                        ]);
                      }
                    }}
                    className="h-7 text-xs"
                  >
                    + Self-Signed TLS
                  </Button>
                </div>
              </div>

              {/* Additional Flags */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <Label>Additional Flags (Optional)</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddFlag}
                    className="h-7 gap-1.5 text-xs"
                  >
                    <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
                    Add Flag
                  </Button>
                </div>

                {additionalFlags.length > 0 && (
                  <div className="space-y-2">
                    {additionalFlags.map((flag, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input
                          required
                          placeholder="--s3-sign-accept-encoding=false"
                          value={flag}
                          onChange={(e) =>
                            handleUpdateFlag(index, e.target.value)
                          }
                          className="font-mono text-sm"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveFlag(index)}
                          className="size-9 shrink-0 text-destructive hover:bg-destructive/10"
                        >
                          <HugeiconsIcon
                            icon={Delete02Icon}
                            className="size-4"
                          />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="flex w-full shrink-0 items-center justify-between border-border/40 border-t p-6 sm:justify-between">
              <Button
                type="button"
                variant="secondary"
                disabled={testConnectionMutation.isPending}
                onClick={handleTestConnection}
              >
                {testConnectionMutation.isPending
                  ? "Testing..."
                  : "Test connection"}
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    createMutation.isPending || updateMutation.isPending
                  }
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? "Saving..."
                    : editId
                      ? "Update"
                      : "Create"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeleteId(null);
        }}
        title="Delete S3 destination?"
        description={
          <>
            This will delete <strong>{deleteName}</strong> and prevent backups
            from using it. This action cannot be undone.
          </>
        }
        actionLabel="Delete destination"
        pending={deleteMutation.isPending}
        onConfirm={handleDeleteSubmit}
      />
    </DashboardPage>
  );
}
