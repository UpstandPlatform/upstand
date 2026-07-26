import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { trpc } from "@/utils/trpc";

export function useBackupSettings({
  resourceId,
  organizationId,
  onSuccessAction,
}: {
  resourceId: string;
  organizationId: string;
  onSuccessAction?: () => void;
}) {
  const queryClient = useQueryClient();

  const schedulesQuery = useQuery({
    ...trpc.backup.listSchedules.queryOptions({ resourceId }),
    refetchInterval: 15_000,
  });

  const runsQuery = useQuery({
    ...trpc.backup.listRuns.queryOptions({
      resourceId,
      limit: 100,
    }),
    refetchInterval: 5_000,
  });

  const destinationsQuery = useQuery({
    ...trpc.s3Destination.list.queryOptions({ organizationId }),
    enabled: Boolean(organizationId),
  });

  const volumesQuery = useQuery({
    ...trpc.backup.listVolumes.queryOptions({ resourceId }),
    enabled: false,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.backup.listSchedules.queryKey({ resourceId }),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.backup.listRuns.queryKey({ resourceId, limit: 100 }),
      }),
    ]);
  };

  const showError = (error: unknown) => {
    toast.error(
      error instanceof Error ? error.message : "Backup action failed",
    );
  };

  const createSchedule = useMutation({
    ...trpc.backup.createSchedule.mutationOptions(),
    onSuccess: async () => {
      toast.success("Backup schedule created");
      if (onSuccessAction) onSuccessAction();
      await refresh();
    },
    onError: showError,
  });

  const updateSchedule = useMutation({
    ...trpc.backup.updateSchedule.mutationOptions(),
    onSuccess: async () => {
      toast.success("Backup schedule updated");
      if (onSuccessAction) onSuccessAction();
      await refresh();
    },
    onError: showError,
  });

  const deleteSchedule = useMutation({
    ...trpc.backup.deleteSchedule.mutationOptions(),
    onSuccess: async () => {
      toast.success("Backup schedule and its stored artifacts were deleted");
      await refresh();
    },
    onError: showError,
  });

  const runNow = useMutation({
    ...trpc.backup.runNow.mutationOptions(),
    onSuccess: async (run) => {
      toast.success(
        run ? "Backup queued" : "A backup for this schedule is already running",
      );
      await refresh();
    },
    onError: showError,
  });

  const restoreRun = useMutation({
    ...trpc.backup.restore.mutationOptions(),
    onSuccess: () => {
      toast.success("Backup restore completed");
    },
    onError: showError,
  });

  return {
    schedules: schedulesQuery.data ?? [],
    schedulesPending: schedulesQuery.isPending,
    runs: runsQuery.data ?? [],
    runsPending: runsQuery.isPending,
    destinations: destinationsQuery.data ?? [],
    volumes: volumesQuery.data ?? [],
    isVolumesFetching: volumesQuery.isFetching,
    refetchVolumes: volumesQuery.refetch,
    createSchedule: createSchedule.mutate,
    isCreatingSchedule: createSchedule.isPending,
    updateSchedule: updateSchedule.mutate,
    isUpdatingSchedule: updateSchedule.isPending,
    deleteSchedule: deleteSchedule.mutate,
    isDeletingSchedule: deleteSchedule.isPending,
    runNow: runNow.mutate,
    isRunningNow: runNow.isPending,
    restoreRun: restoreRun.mutate,
    isRestoring: restoreRun.isPending,
    refreshSchedules: refresh,
  };
}
