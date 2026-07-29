import { useMutation, useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/utils/trpc";

export function useResourceDetail({
  projectId,
  environmentId,
  resourceId,
  activeTab,
  selectedLogContainerId,
  selectedContainerId,
  containerModalOpen,
  statsIntervalEnabled,
  logsSince,
}: {
  projectId: string;
  environmentId: string;
  resourceId: string;
  activeTab: string;
  selectedLogContainerId?: string;
  selectedContainerId?: string;
  containerModalOpen?: boolean;
  statsIntervalEnabled?: boolean;
  logsSince?: number;
}) {
  const router = useRouter();
  const [isDeleted, setIsDeleted] = useState(false);

  const projectQuery = useQuery({
    ...trpc.project.get.queryOptions({ id: projectId }),
  });

  const sshKeysQuery = useQuery({
    ...trpc.sshKey.list.queryOptions({
      organizationId: projectQuery.data?.organizationId as string,
    }),
    enabled: !!projectQuery.data?.organizationId && activeTab === "general",
  });

  const serversQuery = useQuery({
    ...trpc.server.list.queryOptions({
      organizationId: projectQuery.data?.organizationId as string,
    }),
    enabled: !!projectQuery.data?.organizationId,
  });

  const gitProvidersQuery = useQuery({
    ...trpc.gitProvider.list.queryOptions({
      organizationId: projectQuery.data?.organizationId as string,
    }),
    enabled: !!projectQuery.data?.organizationId && activeTab === "general",
  });

  const certificatesQuery = useQuery({
    ...trpc.certificate.list.queryOptions({
      organizationId: projectQuery.data?.organizationId as string,
    }),
    enabled: !!projectQuery.data?.organizationId && activeTab === "domains",
  });

  const resourceQuery = useQuery({
    ...trpc.resource.get.queryOptions({ id: resourceId }),
    enabled: !isDeleted,
    refetchInterval: isDeleted ? false : 3000,
  });

  const routingTargetsQuery = useQuery({
    ...trpc.resource.getRoutingTargets.queryOptions({ id: resourceId }),
    enabled: !isDeleted && !!resourceId && activeTab === "domains",
    staleTime: 15_000,
  });

  const liveContainersQuery = useQuery({
    ...trpc.resource.getContainers.queryOptions({ id: resourceId }),
    enabled: !isDeleted,
    refetchInterval: isDeleted ? false : 5000,
  });

  const secretsQuery = useQuery({
    ...trpc.resource.getSecrets.queryOptions({ id: resourceId }),
    enabled:
      !isDeleted &&
      Boolean(resourceId) &&
      ["general", "environment", "advanced", "containers"].includes(activeTab),
  });

  const deploymentsQuery = useQuery({
    ...trpc.deployment.getByResource.queryOptions({ resourceId }),
    enabled:
      !isDeleted &&
      Boolean(resourceId) &&
      ["general", "deployments"].includes(activeTab),
    refetchInterval:
      !isDeleted && ["general", "deployments"].includes(activeTab)
        ? 3000
        : false,
  });

  const logsQuery = useQuery({
    ...trpc.resource.getLogs.queryOptions({
      id: resourceId,
      containerId:
        selectedLogContainerId === "all" ? undefined : selectedLogContainerId,
      since: logsSince,
    }),
    enabled: !isDeleted && activeTab === "logs",
    refetchInterval: !isDeleted && activeTab === "logs" ? 4000 : false,
  });

  const statsQuery = useQuery({
    ...trpc.resource.getStats.queryOptions({ id: resourceId }),
    refetchInterval: isDeleted ? false : statsIntervalEnabled ? 5000 : false,
    enabled: !isDeleted && !!resourceId && statsIntervalEnabled,
  });

  const containerLogsQuery = useQuery({
    ...trpc.resource.getLogs.queryOptions({
      id: resourceId,
      containerId: selectedContainerId || undefined,
      since: logsSince,
    }),
    enabled: !isDeleted && containerModalOpen && !!selectedContainerId,
    refetchInterval: isDeleted ? false : containerModalOpen ? 3000 : false,
  });

  // Mutations
  const updateResourceMutation = useMutation({
    ...trpc.resource.update.mutationOptions(),
    onSuccess: () => {
      void resourceQuery.refetch();
      void secretsQuery.refetch();
    },
    onError: (err) => toast.error(err.message || "Failed to update resource"),
  });

  const deployResourceMutation = useMutation({
    ...trpc.resource.deploy.mutationOptions(),
    onSuccess: () => {
      toast.success("Deployment triggered successfully");
      void resourceQuery.refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to trigger deployment");
    },
  });

  const controlResourceMutation = useMutation({
    ...trpc.resource.control.mutationOptions(),
    onSuccess: () => {
      toast.success("Command dispatched successfully");
      void resourceQuery.refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to control resource");
    },
  });

  const rebuildDatabaseMutation = useMutation({
    ...trpc.resource.rebuildDatabase.mutationOptions(),
    onSuccess: () => {
      toast.success("Database rebuilt successfully");
      void resourceQuery.refetch();
    },
    onError: (err) => toast.error(err.message || "Failed to rebuild database"),
  });

  const controlContainerMutation = useMutation({
    ...trpc.resource.controlContainer.mutationOptions(),
    onSuccess: () => {
      toast.success("Container command dispatched successfully");
      void resourceQuery.refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to control container");
    },
  });

  const deleteResourceMutation = useMutation({
    ...trpc.resource.delete.mutationOptions(),
    onSuccess: () => {
      setIsDeleted(true);
      toast.success("Resource deleted successfully");
      router.push(`/projects/${projectId}/${environmentId}` as Route);
    },
    onError: (err) => toast.error(err.message || "Failed to delete resource"),
  });

  return {
    project: projectQuery.data,
    sshKeys: sshKeysQuery.data ?? [],
    servers: serversQuery.data ?? [],
    gitProviders: gitProvidersQuery.data ?? [],
    certificates: certificatesQuery.data ?? [],
    resource: resourceQuery.data,
    secrets: secretsQuery.data ?? {
      credentials: "{}",
      envVars: {},
      buildEnvVars: {},
      buildSecretsConfigured: false,
    },
    refetchSecrets: secretsQuery.refetch,
    loadingResource: resourceQuery.isPending,
    refetchResource: resourceQuery.refetch,
    routingTargets: routingTargetsQuery.data ?? [],
    liveContainers: liveContainersQuery.data,
    liveContainersPending: liveContainersQuery.isPending,
    liveContainersError: liveContainersQuery.isError,
    deployments: deploymentsQuery.data ?? [],
    refetchDeployments: deploymentsQuery.refetch,
    logsData: logsQuery.data,
    statsData: statsQuery.data,
    statsError: statsQuery.error?.message,
    isLoadingStats: statsQuery.isPending,
    refetchStats: statsQuery.refetch,
    containerLogsData: containerLogsQuery.data,
    updateResource: updateResourceMutation.mutate,
    isUpdatingResource: updateResourceMutation.isPending,
    deployResource: deployResourceMutation.mutate,
    isDeployingResource: deployResourceMutation.isPending,
    controlResource: controlResourceMutation.mutate,
    isControllingResource: controlResourceMutation.isPending,
    rebuildDatabase: rebuildDatabaseMutation.mutate,
    isRebuildingDatabase: rebuildDatabaseMutation.isPending,
    controlContainer: controlContainerMutation.mutate,
    isControllingContainer: controlContainerMutation.isPending,
    deleteResource: deleteResourceMutation.mutate,
    isDeletingResource: deleteResourceMutation.isPending,
  };
}

export type ResourceDetailState = ReturnType<typeof useResourceDetail>;
