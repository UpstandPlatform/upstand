"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import { getUpGalTargetDefinition } from "@upstand/api/ai/upgal-ui-targets";
import type { AppRouter } from "@upstand/api/router";
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
import { Field, FieldGroup, FieldLabel } from "@upstand/ui/components/field";
import { Input } from "@upstand/ui/components/input";
import { Spinner } from "@upstand/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import {
  DashboardPage,
  DashboardPageHeader,
} from "@/components/dashboard/dashboard-page";
import { PageEmpty } from "@/components/dashboard/page-empty";
import { CardGridSkeleton } from "@/components/dashboard/page-skeleton";
import {
  Database,
  Edit2,
  Layers,
  PlusIcon,
  Trash2Icon,
} from "@/components/huge-icons";
import { UpGalTarget } from "@/components/upgal-target";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { useSystemConfig } from "@/hooks/use-system-config";
import { trpc } from "@/utils/trpc";

const createDockerRegistryTarget = getUpGalTargetDefinition(
  "create-docker-registry",
);
type DockerRegistry =
  inferRouterOutputs<AppRouter>["dockerRegistry"]["list"][number];
type DockerRegistryError = TRPCClientErrorLike<AppRouter>;

export default function DockerRegistryPage() {
  const organizationState = useRequiredActiveOrganization();
  const { isCloud } = useSystemConfig();
  const organizationId = organizationState.organizationId as string;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [imagePrefix, setImagePrefix] = useState("");
  const [registryUrl, setRegistryUrl] = useState("");
  const [serverId, setServerId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setUsername("");
    setPassword("");
    setImagePrefix("");
    setRegistryUrl("");
    setServerId("");
  };

  const {
    data: registries,
    refetch,
    isPending: loadingRegistries,
  } = useQuery({
    ...trpc.dockerRegistry.list.queryOptions({ organizationId }),
    enabled: organizationState.status === "ready",
  });

  const createMutation = useMutation({
    ...trpc.dockerRegistry.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Docker registry added successfully!");
      setDialogOpen(false);
      resetForm();
      refetch();
    },
    onError: (error: DockerRegistryError) => {
      toast.error(error.message || "Failed to add registry");
    },
  });

  const deleteMutation = useMutation({
    ...trpc.dockerRegistry.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("Docker registry deleted");
      setDeleteTarget(null);
      refetch();
    },
    onError: (error: DockerRegistryError) => {
      toast.error(error.message || "Failed to delete registry");
    },
  });

  const updateMutation = useMutation({
    ...trpc.dockerRegistry.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Docker registry updated successfully!");
      setDialogOpen(false);
      resetForm();
      refetch();
    },
    onError: (error: DockerRegistryError) =>
      toast.error(error.message || "Failed to update registry"),
  });

  const testConnectionMutation = useMutation({
    ...trpc.dockerRegistry.testConnection.mutationOptions(),
    onSuccess: (result) => {
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    },
    onError: (error: DockerRegistryError) => {
      toast.error(error.message || "Unable to test connection");
    },
  });

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (reg: DockerRegistry): void => {
    setEditingId(reg.id);
    setName(reg.name);
    setUsername(reg.username || "");
    setPassword("");
    setImagePrefix(reg.imagePrefix || "");
    setRegistryUrl(reg.registryUrl || "");
    setServerId(reg.serverId || "");
    setDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    const registry = registries?.find((item) => item.id === id);
    setDeleteTarget(registry ? { id: registry.id, name: registry.name } : null);
  };

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (isCloud && !serverId.trim()) {
      toast.error("Please enter a Target Server ID.");
      return;
    }
    const payload = {
      organizationId,
      name,
      username: username || null,
      password: password || null,
      imagePrefix: imagePrefix || null,
      registryUrl: registryUrl || null,
      serverId: serverId || null,
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleTestConnection = () => {
    testConnectionMutation.mutate({
      organizationId,
      username: username || null,
      password: password || null,
      registryUrl: registryUrl || null,
    });
  };

  return (
    <DashboardPage>
      <DashboardPageHeader
        title="Docker Registry"
        description="Configure external Docker registries to publish and pull images during deployments."
        icon={<Layers className="size-6 text-primary" />}
        actions={
          <UpGalTarget definition={createDockerRegistryTarget}>
            <Button onClick={openCreate} className="gap-2 font-medium">
              <PlusIcon data-icon="inline-start" />
              Add External Registry
            </Button>
          </UpGalTarget>
        }
      />

      {loadingRegistries ? (
        <CardGridSkeleton count={3} />
      ) : registries && registries.length > 0 ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {registries.map((reg: DockerRegistry) => (
            <Card
              key={reg.id}
              className="relative overflow-hidden border-border/40 bg-card/30"
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="space-y-1">
                  <CardTitle className="font-semibold text-base">
                    {reg.name}
                  </CardTitle>
                  <CardDescription className="font-mono text-muted-foreground text-xs">
                    {reg.registryUrl || "Docker Hub"}
                  </CardDescription>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => openEdit(reg)}
                    aria-label={`Edit registry ${reg.name}`}
                  >
                    <Edit2 />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(reg.id)}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Delete registry ${reg.name}`}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-2 text-muted-foreground text-xs">
                <div className="flex flex-col gap-1">
                  <div>
                    <span className="font-medium text-foreground">
                      Username:{" "}
                    </span>
                    {reg.username || "Anonymous"}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">
                      Image Prefix:{" "}
                    </span>
                    {reg.imagePrefix || "None"}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <PageEmpty
          icon={Database}
          title="No Docker registries yet"
          description="Add a registry such as GHCR, Amazon ECR, or a self-hosted registry to configure deployment pipelines."
          action={
            <Button onClick={openCreate} className="gap-2">
              <PlusIcon data-icon="inline-start" />
              Add External Registry
            </Button>
          }
        />
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit External Registry" : "Add External Registry"}
            </DialogTitle>
            <DialogDescription>
              Provide connection details to link and authenticate with your
              custom Docker registry.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">Registry Name</FieldLabel>
                <Input
                  id="name"
                  required
                  placeholder="My Registry"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="username">Username</FieldLabel>
                <Input
                  id="username"
                  placeholder="e.g. janesmith"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="password">Password / Token</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="imagePrefix">Image Prefix</FieldLabel>
                <Input
                  id="imagePrefix"
                  placeholder="e.g. my-company"
                  value={imagePrefix}
                  onChange={(e) => setImagePrefix(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="registryUrl">Registry URL</FieldLabel>
                <Input
                  id="registryUrl"
                  placeholder="e.g. https://ghcr.io"
                  value={registryUrl}
                  onChange={(e) => setRegistryUrl(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="serverId">
                  {isCloud ? "Target Server ID" : "Server (Optional)"}
                </FieldLabel>
                <Input
                  id="serverId"
                  required={isCloud}
                  placeholder={isCloud ? "Enter server ID" : "Server ID"}
                  value={serverId}
                  onChange={(e) => setServerId(e.target.value)}
                />
              </Field>
            </FieldGroup>

            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleTestConnection}
                disabled={testConnectionMutation.isPending}
              >
                {testConnectionMutation.isPending ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    Testing…
                  </>
                ) : (
                  "Test Registry"
                )}
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    Saving…
                  </>
                ) : editingId ? (
                  "Save Changes"
                ) : (
                  "Create Registry"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name ?? "Docker Registry"}?`}
        description={`${deleteTarget?.name ?? "This registry"} will be permanently deleted and unavailable to deployments. This action cannot be undone.`}
        actionLabel="Delete Registry"
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate({ id: deleteTarget.id });
        }}
      />
    </DashboardPage>
  );
}
