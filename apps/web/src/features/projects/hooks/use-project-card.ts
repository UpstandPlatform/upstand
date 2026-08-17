"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@upstand/api/router";
import { trpc } from "@/utils/trpc";

type Project = inferRouterOutputs<AppRouter>["project"]["list"][number];

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function useProjectCard({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const updateMutation = useMutation({
    ...trpc.project.update.mutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: trpc.project.list.queryKey(),
      });
    },
  });

  const { data: environments } = useQuery({
    ...trpc.environment.list.queryOptions({ projectId: project.id }),
    enabled: Boolean(project.id),
  });

  const totalResources =
    environments?.reduce(
      (total, environment) => total + environment.resourceCount,
      0,
    ) ?? 0;

  return {
    environmentCount: environments?.length ?? 0,
    formattedCreatedAt: dateFormatter.format(new Date(project.createdAt)),
    isUpdating: updateMutation.isPending,
    totalResources,
    archiveOrRestore: () => {
      updateMutation.mutate({
        id: project.id,
        archived: !project.archivedAt,
      });
    },
    updateIcon: async (icon: string | null) => {
      await updateMutation.mutateAsync({ id: project.id, icon });
    },
  };
}
