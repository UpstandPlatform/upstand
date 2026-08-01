import type { ServerType } from "@upstand/domain";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Spinner } from "@upstand/ui/components/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@upstand/ui/components/tooltip";
import {
  StatusBadge,
  type StatusTone,
} from "@/components/dashboard/status-badge";
import {
  Edit2,
  ShieldCheck,
  TerminalIcon,
  Trash2Icon,
  WrenchIcon,
} from "@/components/huge-icons";

export interface RemoteServerItem {
  id: string;
  name: string;
  description?: string | null;
  serverType: ServerType;
  authType?: string;
  sshKeyId?: string | null;
  ipAddress: string;
  port: number;
  username: string;
  enableDockerCleanup: boolean;
  status: string;
  updatedAt?: Date | string;
  setupStage?: string | null;
}

export interface RemoteServerCardProps {
  server: RemoteServerItem;
  onTerminal: (serverId: string) => void;
  onEdit: (server: RemoteServerItem) => void;
  onDelete: (serverId: string, serverName: string) => void;
  onSetup: (serverId: string) => void;
  onInspect: (serverId: string) => void;
}

function isServerStuck(server: RemoteServerItem): boolean {
  if (server.status !== "setting_up" || !server.updatedAt) return false;
  const updatedTime = new Date(server.updatedAt).getTime();
  const TEN_MINUTES = 10 * 60 * 1000;
  return Date.now() - updatedTime > TEN_MINUTES;
}

function getStatusBadgeTone(server: RemoteServerItem): StatusTone {
  if (isServerStuck(server)) return "warning";
  switch (server.status) {
    case "ready":
      return "success";
    case "setting_up":
      return "info";
    case "failed":
      return "destructive";
    default:
      return "secondary";
  }
}

export function RemoteServerCard({
  server,
  onTerminal,
  onEdit,
  onDelete,
  onSetup,
  onInspect,
}: RemoteServerCardProps) {
  const handleTerminal = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onTerminal(server.id);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onEdit(server);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDelete(server.id, server.name);
  };

  const handleSetup = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSetup(server.id);
  };

  const handleInspect = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onInspect(server.id);
  };

  const stuck = isServerStuck(server);

  const setupLabel = stuck
    ? "Setup seems stuck — Click to resume setup"
    : server.status === "setting_up"
      ? server.setupStage
        ? `Setting up: ${server.setupStage}`
        : "Setting up…"
      : server.status === "ready"
        ? "Set up server again"
        : "Set up server";

  const authLabel = server.authType === "password" ? "Password" : "SSH Key";

  return (
    <Card className="flex h-full flex-col justify-between">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CardTitle className="truncate text-base">{server.name}</CardTitle>
            <span className="inline-flex items-center rounded-md bg-secondary/80 px-2 py-0.5 font-medium text-secondary-foreground text-xs">
              {authLabel}
            </span>
          </div>
          <CardDescription className="mt-1 line-clamp-2">
            {server.description || "Remote deployment environment"}
          </CardDescription>
        </div>
        <StatusBadge
          tone={getStatusBadgeTone(server)}
          label={
            stuck
              ? "Stuck (Resume)"
              : server.status === "ready"
                ? "Ready"
                : server.status === "setting_up"
                  ? server.setupStage || "Setting up"
                  : server.status === "failed"
                    ? "Failed"
                    : server.status
          }
        />
      </CardHeader>

      <CardFooter className="flex items-center justify-between gap-2 border-t">
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Open terminal for ${server.name}`}
                  onClick={handleTerminal}
                >
                  <TerminalIcon aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>Terminal</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Edit ${server.name}`}
                  onClick={handleEdit}
                >
                  <Edit2 aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="destructive"
                  size="icon-sm"
                  aria-label={`Delete ${server.name}`}
                  onClick={handleDelete}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={server.status === "ready" ? "outline" : "default"}
                  size="icon-sm"
                  aria-label={setupLabel}
                  onClick={handleSetup}
                  disabled={server.status === "setting_up"}
                >
                  {server.status === "setting_up" ? (
                    <Spinner className="size-4" />
                  ) : (
                    <WrenchIcon aria-hidden="true" />
                  )}
                </Button>
              }
            />
            <TooltipContent>{setupLabel}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Validate ${server.name}`}
                  onClick={handleInspect}
                >
                  <ShieldCheck aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>Validate</TooltipContent>
          </Tooltip>
        </div>
      </CardFooter>
    </Card>
  );
}
