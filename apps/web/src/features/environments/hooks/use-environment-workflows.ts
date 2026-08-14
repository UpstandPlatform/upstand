import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@upstand/api/router";
import { useCallback, useState } from "react";
import { trpc } from "@/utils/trpc";

export type EnvironmentWorkflowDiff =
  inferRouterOutputs<AppRouter>["environment"]["diff"];

export function useEnvironmentWorkflows(sourceEnvironmentId: string) {
  const queryClient = useQueryClient();
  const [targetEnvironmentId, setTargetEnvironmentId] = useState("");
  const [diff, setDiff] = useState<EnvironmentWorkflowDiff | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const compare = useCallback(
    async (targetId: string) => {
      if (!targetId) return null;
      setIsComparing(true);
      setCompareError(null);
      try {
        const nextDiff = await queryClient.fetchQuery(
          trpc.environment.diff.queryOptions({
            sourceEnvironmentId,
            targetEnvironmentId: targetId,
          }),
        );
        setDiff(nextDiff);
        return nextDiff;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to compare environments.";
        setCompareError(message);
        return null;
      } finally {
        setIsComparing(false);
      }
    },
    [queryClient, sourceEnvironmentId],
  );

  const selectTargetEnvironment = useCallback((targetId: string) => {
    setTargetEnvironmentId(targetId);
    setDiff(null);
    setCompareError(null);
  }, []);

  const promote = useMutation({
    ...trpc.environment.promote.mutationOptions(),
    onSuccess: async (nextDiff) => {
      setDiff(nextDiff);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: trpc.environment.get.queryKey({
            id: sourceEnvironmentId,
          }),
        }),
        queryClient.invalidateQueries({
          queryKey: trpc.environment.list.queryKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: trpc.resource.list.queryKey(),
        }),
      ]);
    },
  });

  return {
    compare,
    compareError,
    diff,
    isComparing,
    promote,
    selectTargetEnvironment,
    targetEnvironmentId,
  };
}
