import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Spinner } from "@upstand/ui/components/spinner";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SelfUpdateDialog } from "@/components/self-update-dialog";
import { trpc } from "@/utils/trpc";

export function AppInfoPanel() {
  const queryClient = useQueryClient();
  const [updateDialogVersion, setUpdateDialogVersion] = useState<string>();

  const { data, isFetching, refetch } = useQuery({
    ...trpc.webServer.getUpdateData.queryOptions(),
  });

  const { data: systemStatus } = useQuery({
    ...trpc.webServer.getSystemStatus.queryOptions(),
    refetchInterval: 10000,
  });

  const [serverTimeOffset, setServerTimeOffset] = useState<number | null>(null);
  const [timeStr, setTimeStr] = useState<string>("Loading…");

  useEffect(() => {
    if (systemStatus?.serverTime) {
      const serverMs = new Date(systemStatus.serverTime).getTime();
      const clientMs = Date.now();
      setServerTimeOffset(serverMs - clientMs);
    }
  }, [systemStatus?.serverTime]);

  useEffect(() => {
    const updateTime = () => {
      if (serverTimeOffset !== null && systemStatus?.timeZoneId) {
        try {
          const currentServerMs = Date.now() + serverTimeOffset;
          const currentServerDate = new Date(currentServerMs);
          const formatter = new Intl.DateTimeFormat("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            timeZone: systemStatus.timeZoneId,
          });
          setTimeStr(formatter.format(currentServerDate));
        } catch {
          // fallback to UTC time
          const currentServerMs = Date.now() + serverTimeOffset;
          const currentServerDate = new Date(currentServerMs);
          const hours = String(currentServerDate.getUTCHours()).padStart(
            2,
            "0",
          );
          const minutes = String(currentServerDate.getUTCMinutes()).padStart(
            2,
            "0",
          );
          const seconds = String(currentServerDate.getUTCSeconds()).padStart(
            2,
            "0",
          );
          setTimeStr(`${hours}:${minutes}:${seconds}`);
        }
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [serverTimeOffset, systemStatus?.timeZoneId]);

  const checkUpdates = useMutation({
    ...trpc.webServer.checkForUpdates.mutationOptions(),
    onSuccess: (result) => {
      queryClient.setQueryData(trpc.webServer.getUpdateData.queryKey(), result);
    },
    onError: (error) => toast.error(error.message),
  });

  const update = useMutation({
    ...trpc.webServer.triggerUpdate.mutationOptions(),
    onSuccess: (_, variables) => {
      setUpdateDialogVersion(variables.version);
      void refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const handleCheck = async () => {
    const result = await checkUpdates.mutateAsync();
    if (result.channel === "managed") {
      toast.info("Cloud Upstand is updated by the managed release rollout.");
    } else if (result.updateAvailable) {
      toast.info(`Upstand ${result.latestVersion} is available.`);
    } else if (result.channel === "source" && !result.updateAvailable) {
      toast.info(
        "This source installation is updated by rerunning the installer.",
      );
    } else if (result.channel === "source") {
      toast.info(
        `Upstand ${result.latestVersion} is available. Re-run the installer to update.`,
      );
    } else {
      toast.success(
        `Upstand is up to date (${result.currentVersion ?? "unknown"}).`,
      );
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Upstand Platform</CardTitle>
          <CardDescription>System and version information.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col divide-y text-sm">
            {[
              {
                label: "Server Time",
                value: (
                  <div className="flex items-center gap-2">
                    <span className="font-bold font-mono text-foreground text-xs">
                      {timeStr}
                    </span>
                    {systemStatus && (
                      <Badge
                        variant="outline"
                        className="h-4.5 rounded-full px-2 py-0 font-mono text-[10px] text-muted-foreground"
                      >
                        {systemStatus.timeZone} | {systemStatus.timeZoneOffset}
                      </Badge>
                    )}
                  </div>
                ),
              },
              {
                label: "Version",
                value: (
                  <span className="font-medium font-mono text-foreground text-xs">
                    {data?.currentVersion ?? "Loading…"}
                  </span>
                ),
              },
              {
                label: "Channel",
                value: (
                  <span className="font-medium font-mono text-foreground text-xs">
                    {data?.channel ?? "unknown"}
                  </span>
                ),
              },
              {
                label: "API Server",
                value: systemStatus ? (
                  <Badge
                    variant="success"
                    className="h-4.5 rounded-full px-2 py-0.5 font-mono text-[10px]"
                  >
                    Connected
                  </Badge>
                ) : (
                  <span className="font-medium font-mono text-muted-foreground text-xs">
                    Loading…
                  </span>
                ),
              },
              {
                label: "Database",
                value: systemStatus ? (
                  systemStatus.database === "connected" ? (
                    <Badge
                      variant="success"
                      className="h-4.5 rounded-full px-2 py-0.5 font-mono text-[10px]"
                    >
                      Connected
                    </Badge>
                  ) : (
                    <Badge
                      variant="destructive"
                      className="h-4.5 rounded-full px-2 py-0.5 font-mono text-[10px]"
                    >
                      Disconnected
                    </Badge>
                  )
                ) : (
                  <span className="font-medium font-mono text-muted-foreground text-xs">
                    Loading…
                  </span>
                ),
              },
              {
                label: "Redis",
                value: systemStatus ? (
                  systemStatus.redis === "connected" ? (
                    <Badge
                      variant="success"
                      className="h-4.5 rounded-full px-2 py-0.5 font-mono text-[10px]"
                    >
                      Connected
                    </Badge>
                  ) : (
                    <Badge
                      variant="destructive"
                      className="h-4.5 rounded-full px-2 py-0.5 font-mono text-[10px]"
                    >
                      Disconnected
                    </Badge>
                  )
                ) : (
                  <span className="font-medium font-mono text-muted-foreground text-xs">
                    Loading…
                  </span>
                ),
              },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
              >
                <span className="text-muted-foreground">{label}</span>
                {value}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={isFetching || checkUpdates.isPending}
              onClick={handleCheck}
            >
              {(isFetching || checkUpdates.isPending) && (
                <Spinner data-icon="inline-start" />
              )}
              {checkUpdates.isPending ? "Checking…" : "Check for Updates"}
            </Button>
            {data?.updateAvailable && data.canUpdate ? (
              <Button
                size="sm"
                disabled={update.isPending}
                onClick={() =>
                  data.images &&
                  update.mutate({
                    version: data.latestVersion,
                    images: data.images,
                  })
                }
              >
                {update.isPending
                  ? "Updating…"
                  : `Update to ${data.latestVersion}`}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
      {updateDialogVersion ? (
        <SelfUpdateDialog open version={updateDialogVersion} />
      ) : null}
    </>
  );
}
