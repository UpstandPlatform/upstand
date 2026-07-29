"use client";

import {
  Alert02Icon,
  ArrowRight01Icon,
  Clock01Icon,
  ComputerIcon,
  DatabaseIcon,
  Key01Icon,
  PlusSignIcon,
  RefreshIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@upstand/api/router";
import { DATABASE_IMAGE_OPTIONS, type DatabaseType } from "@upstand/domain";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@upstand/ui/components/alert-dialog";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import { Checkbox } from "@upstand/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@upstand/ui/components/dropdown-menu";
import { Input } from "@upstand/ui/components/input";
import { Label } from "@upstand/ui/components/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Separator } from "@upstand/ui/components/separator";
import { Spinner } from "@upstand/ui/components/spinner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@upstand/ui/components/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@upstand/ui/components/tooltip";
import { cn } from "@upstand/ui/lib/utils";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import { DangerZoneCard } from "@/components/dashboard/danger-zone-card";
import { EditableEntityIcon } from "@/components/editable-entity-icon";
import { Trash2Icon } from "@/components/huge-icons";
import { SecretHistoryDialog } from "@/components/secrets/secret-history-dialog";
import { SecretRotationDialog } from "@/components/secrets/secret-rotation-dialog";
import { SecretSyncDialog } from "@/components/secrets/secret-sync-dialog";
import {
  KeyValueEditor,
  keyValuePairsToRecord,
  recordToKeyValuePairs,
} from "@/components/shared/key-value-editor";
import { useSystemConfig } from "@/hooks/use-system-config";
import type { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

type Resource = inferRouterOutputs<AppRouter>["resource"]["list"][number];
type Server = inferRouterOutputs<AppRouter>["server"]["list"][number];
type EnvironmentDiff = inferRouterOutputs<AppRouter>["environment"]["diff"];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

// ─── Icons Map ────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, IconSvgElement> = {
  application: ComputerIcon,
  database: DatabaseIcon,
  compose: ServerStack01Icon,
};

const TYPE_BG: Record<string, string> = {
  application: "bg-primary/10 text-primary",
  database: "bg-warning/10 text-warning",
  compose: "bg-info/10 text-info",
};

// ─── Resource Card ────────────────────────────────────────────────────────────

function ResourceCard({
  projectId,
  environmentId,
  resource,
  serverName,
  onDelete,
}: {
  projectId: string;
  environmentId: string;
  resource: Pick<
    Resource,
    "id" | "name" | "type" | "status" | "provider" | "serverId" | "icon"
  >;
  serverName: string;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const updateResourceMutation = useMutation({
    ...trpc.resource.update.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: trpc.resource.list.queryKey(),
      });
    },
  });

  const Icon = TYPE_ICONS[resource.type] || ComputerIcon;
  const isRunning = resource.status === "running";

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDelete();
  };

  return (
    <Card size="sm" className="flex flex-col justify-between">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <EditableEntityIcon
            icon={resource.icon}
            defaultIcon={
              <HugeiconsIcon
                icon={Icon}
                className="size-4"
                aria-hidden="true"
              />
            }
            entityName={resource.name}
            entityType="resource"
            sizeClassName="size-9 rounded-2xl"
            bgClassName={TYPE_BG[resource.type] || "bg-primary/10 text-primary"}
            onSaveIcon={async (newIcon) => {
              await updateResourceMutation.mutateAsync({
                id: resource.id,
                icon: newIcon,
              });
            }}
          />
          <div className="min-w-0">
            <CardTitle className="truncate text-base">
              <Link
                href={
                  `/projects/${projectId}/${environmentId}/${resource.id}` as Route
                }
                className="hover:underline"
              >
                {resource.name}
              </Link>
            </CardTitle>
            <CardDescription className="font-semibold text-[10px] uppercase tracking-wider">
              {resource.type}
            </CardDescription>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/30 bg-accent/20 px-2 py-0.5">
          <span className="relative flex h-2 w-2">
            {isRunning && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            )}
            <span
              className={cn(
                "relative inline-flex h-2 w-2 rounded-full",
                isRunning ? "bg-success" : "bg-muted-foreground/50",
              )}
            />
          </span>
          <span className="font-semibold text-[10px] text-foreground uppercase tracking-wider">
            {resource.status}
          </span>
        </div>
      </CardHeader>

      <Separator />

      <CardFooter className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">
          Server:{" "}
          <span className="font-semibold text-foreground">{serverName}</span>
          <span className="px-1.5 text-border">·</span>
          Provider:{" "}
          <span className="font-semibold text-foreground uppercase">
            {resource.provider}
          </span>
        </span>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="destructive"
                size="icon-sm"
                onClick={handleDelete}
                aria-label={`Delete resource ${resource.name}`}
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            }
          />
          <TooltipContent>Delete</TooltipContent>
        </Tooltip>
      </CardFooter>
    </Card>
  );
}

function TargetServerField({
  id,
  serverId,
  isCloud,
  servers,
  description,
  onServerChange,
}: {
  id: string;
  serverId: string;
  isCloud: boolean;
  servers: ReadonlyArray<Server>;
  description: string;
  onServerChange: (serverId: string) => void;
}) {
  const deployServers = servers.filter(
    (server) => server.status === "ready" && server.serverType === "deploy",
  );

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Target Server</Label>
      <Select
        items={[
          ...(!isCloud
            ? [{ value: "local", label: "Local Server (Leader)" }]
            : []),
          ...deployServers.map((server) => ({
            value: server.id,
            label: `${server.name} (${server.ipAddress})`,
          })),
        ]}
        value={serverId}
        onValueChange={(value) => value && onServerChange(value)}
      >
        <SelectTrigger
          id={id}
          className="border-border/40 focus:border-primary"
        >
          <SelectValue
            placeholder={isCloud ? "Select Server" : "Local Server"}
          />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {!isCloud && (
              <SelectItem value="local">Local Server (Leader)</SelectItem>
            )}
            {deployServers.map((server) => (
              <SelectItem key={server.id} value={server.id}>
                {server.name} ({server.ipAddress})
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">{description}</p>
    </div>
  );
}

function ResourceNameFields({
  nameId,
  serviceNameId,
  serviceLabel,
  placeholder,
  name,
  appName,
  onNameChange,
  onAppNameChange,
  autoFocus = false,
}: {
  nameId: string;
  serviceNameId: string;
  serviceLabel: string;
  placeholder: string;
  name: string;
  appName: string;
  onNameChange: (name: string) => void;
  onAppNameChange: (name: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={nameId}>Name</Label>
        <Input
          id={nameId}
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          autoFocus={autoFocus}
          className="border-border/40 focus:border-primary"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={serviceNameId}>{serviceLabel}</Label>
        <Input
          id={serviceNameId}
          value={appName}
          onChange={(event) => onAppNameChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="border-border/40 focus:border-primary"
        />
      </div>
    </>
  );
}

function CreateAppDialog({
  open,
  onOpenChange,
  environmentId,
  projectName,
  organizationId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  environmentId: string;
  projectName: string;
  organizationId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [appName, setAppName] = useState("");
  const [description, setDescription] = useState("");
  const { isCloud } = useSystemConfig();
  const [serverId, setServerId] = useState(() => (isCloud ? "" : "local"));

  useEffect(() => {
    setServerId(isCloud ? "" : "local");
  }, [isCloud]);

  const { data: servers = [] } = useQuery({
    ...trpc.server.list.queryOptions({ organizationId }),
    enabled: Boolean(organizationId),
  });

  const handleNameChange = (val: string) => {
    setName(val);
    const prefix = projectName
      ? `${projectName.toLowerCase().replace(/[^a-z0-9]/g, "-")}-`
      : "";
    const suffix = val.toLowerCase().replace(/[^a-z0-9]/g, "-");
    setAppName(prefix + suffix);
  };

  const mutation = useMutation({
    ...trpc.resource.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Application created successfully");
      setName("");
      setAppName("");
      setDescription("");
      setServerId(isCloud ? "" : "local");
      onOpenChange(false);
      onCreated();
    },
    onError: (err) =>
      toast.error(err.message || "Failed to create application"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="no-scrollbar max-h-[90svh] w-[calc(100vw-1rem)] max-w-[min(96vw,48rem)] sm:min-w-xl">
        <DialogHeader>
          <DialogTitle className="font-bold text-xl">
            New Application
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            Deploy a new app in this environment.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && appName.trim()) {
              if (isCloud && (!serverId || serverId === "local")) {
                toast.error("Please select a target server for deployment.");
                return;
              }
              mutation.mutate({
                environmentId,
                name: name.trim(),
                type: "application",
                appName: appName.trim(),
                description: description.trim() || undefined,
                serverId: serverId === "local" ? undefined : serverId,
              });
            }
          }}
          className="space-y-4 pt-2"
        >
          <ResourceNameFields
            nameId="app-name"
            serviceNameId="app-service-name"
            serviceLabel="Docker Swarm Service Name"
            placeholder="e.g. node-api"
            name={name}
            appName={appName}
            onNameChange={handleNameChange}
            onAppNameChange={setAppName}
            autoFocus
          />
          <TargetServerField
            id="app-server"
            serverId={serverId}
            isCloud={isCloud}
            servers={servers}
            onServerChange={setServerId}
            description="Select which server node in your cluster to deploy this application on."
          />
          <div className="space-y-2">
            <Label htmlFor="app-desc">Description</Label>
            <Input
              id="app-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="App description (optional)"
              autoComplete="off"
              className="border-border/40 focus:border-primary"
            />
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="font-medium"
              disabled={mutation.isPending || !name.trim() || !appName.trim()}
            >
              {mutation.isPending ? "Deploying..." : "Deploy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const generatePassword = (length = 16) => {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let pwd = "";
  for (let i = 0; i < length; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd;
};

function CreateDbDialog({
  open,
  onOpenChange,
  environmentId,
  projectName,
  organizationId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  environmentId: string;
  projectName: string;
  organizationId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [appName, setAppName] = useState("");
  const [dbType, setDbType] = useState<DatabaseType>("postgres");
  const [dockerImage, setDockerImage] = useState<string>(
    DATABASE_IMAGE_OPTIONS.postgres[0],
  );
  const [customImage, setCustomImage] = useState("");
  const [description, setDescription] = useState("");
  const { isCloud } = useSystemConfig();
  const [serverId, setServerId] = useState(() => (isCloud ? "" : "local"));

  useEffect(() => {
    setServerId(isCloud ? "" : "local");
  }, [isCloud]);

  const { data: servers = [] } = useQuery({
    ...trpc.server.list.queryOptions({ organizationId }),
    enabled: Boolean(organizationId),
  });

  const [dbUser, setDbUser] = useState("upstand_user");
  const [dbPassword, setDbPassword] = useState("");
  const [dbName, setDbName] = useState("upstand_db");
  const [dbRootPassword, setDbRootPassword] = useState("");
  const [externalPort, setExternalPort] = useState("");
  const [libsqlGrpcPort, setLibsqlGrpcPort] = useState("");
  const [libsqlAdminPort, setLibsqlAdminPort] = useState("");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const handleNameChange = (val: string) => {
    setName(val);
    const prefix = projectName
      ? `${projectName.toLowerCase().replace(/[^a-z0-9]/g, "-")}-`
      : "";
    const suffix = val.toLowerCase().replace(/[^a-z0-9]/g, "-");
    setAppName(prefix + suffix);
  };

  const handleDbTypeChange = useCallback((val: DatabaseType | null) => {
    if (!val) return;
    setDbType(val);
    setDockerImage(DATABASE_IMAGE_OPTIONS[val][0]);
    setCustomImage("");
    setExternalPort("");
    setLibsqlGrpcPort("");
    setLibsqlAdminPort("");
    const pass = generatePassword();
    const rootPass = generatePassword();
    setDbPassword(pass);
    setDbRootPassword(rootPass);

    if (val === "redis") {
      setDbUser("");
      setDbName("");
    } else if (val === "mongodb") {
      setDbUser("admin");
      setDbName("");
    } else {
      setDbUser("upstand_user");
      setDbName("upstand_db");
    }
    setFormErrors({});
  }, []);

  useEffect(() => {
    if (open) {
      setName("");
      setAppName("");
      setDescription("");
      handleDbTypeChange("postgres");
    }
  }, [open, handleDbTypeChange]);

  const mutation = useMutation({
    ...trpc.resource.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Database created successfully");
      onOpenChange(false);
      onCreated();
    },
    onError: (err) => toast.error(err.message || "Failed to create database"),
  });

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "Database name is required";
    if (!appName.trim())
      errors.appName = "Docker Swarm Service Name is required";

    if (dbType !== "redis") {
      if (!dbUser.trim()) errors.dbUser = "Database user is required";
    }
    if (dbType !== "redis" && dbType !== "mongodb") {
      if (!dbName.trim()) errors.dbName = "Database name (catalog) is required";
    }
    if (!dbPassword.trim()) {
      errors.dbPassword = "Password is required";
    }

    if (
      (dbType === "mysql" || dbType === "mariadb") &&
      !dbRootPassword.trim()
    ) {
      errors.dbRootPassword = "Root password is required";
    }
    if (dbType === "libsql") {
      const ports = [externalPort, libsqlGrpcPort, libsqlAdminPort]
        .filter((value) => value.trim().length > 0)
        .map((value) => Number(value));
      if (
        ports.some(
          (port) => !Number.isInteger(port) || port < 1 || port > 65535,
        )
      ) {
        errors.libsqlPorts = "Published ports must be integers from 1 to 65535";
      } else if (new Set(ports).size !== ports.length) {
        errors.libsqlPorts = "libSQL published ports must be distinct";
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="no-scrollbar max-h-[90svh] w-[calc(100vw-1rem)] max-w-[min(96vw,48rem)] sm:min-w-xl">
        <DialogHeader>
          <DialogTitle className="font-bold text-xl">New Database</DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            Deploy a new managed database in this environment.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (validateForm()) {
              if (isCloud && (!serverId || serverId === "local")) {
                toast.error("Please select a target server for deployment.");
                return;
              }
              const credsPayload = JSON.stringify({
                dbUser: dbUser.trim(),
                dbPassword: dbPassword.trim(),
                dbName: dbName.trim(),
                dbRootPassword: dbRootPassword.trim(),
              });

              mutation.mutate({
                environmentId,
                name: name.trim(),
                type: "database",
                appName: appName.trim(),
                description: description.trim() || undefined,
                dbType,
                dockerImage: customImage.trim() || dockerImage,
                allowCustomImage: Boolean(customImage.trim()),
                credentials: credsPayload,
                externalPort: externalPort.trim()
                  ? Number(externalPort)
                  : undefined,
                libsqlGrpcPort:
                  dbType === "libsql" && libsqlGrpcPort.trim()
                    ? Number(libsqlGrpcPort)
                    : undefined,
                libsqlAdminPort:
                  dbType === "libsql" && libsqlAdminPort.trim()
                    ? Number(libsqlAdminPort)
                    : undefined,
                serverId: serverId === "local" ? undefined : serverId,
              });
            }
          }}
          className="space-y-4 pt-2"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="db-type">Database Engine</Label>
              <Select
                items={[
                  { value: "postgres", label: "PostgreSQL" },
                  { value: "mysql", label: "MySQL" },
                  { value: "mariadb", label: "MariaDB" },
                  { value: "mongodb", label: "MongoDB" },
                  { value: "redis", label: "Redis" },
                  { value: "libsql", label: "libSQL" },
                ]}
                value={dbType}
                onValueChange={handleDbTypeChange}
              >
                <SelectTrigger id="db-type">
                  <SelectValue placeholder="Select Engine" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="postgres">PostgreSQL</SelectItem>
                  <SelectItem value="mysql">MySQL</SelectItem>
                  <SelectItem value="mariadb">MariaDB</SelectItem>
                  <SelectItem value="mongodb">MongoDB</SelectItem>
                  <SelectItem value="redis">Redis</SelectItem>
                  <SelectItem value="libsql">libSQL</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="db-image">Image version</Label>
              <Select
                items={DATABASE_IMAGE_OPTIONS[dbType].map((image) => ({
                  value: image,
                  label: image,
                }))}
                value={dockerImage}
                onValueChange={(value) => {
                  if (value) {
                    setCustomImage("");
                    setDockerImage(value);
                  }
                }}
              >
                <SelectTrigger id="db-image">
                  <SelectValue placeholder="Select image version" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {DATABASE_IMAGE_OPTIONS[dbType].map((image) => (
                      <SelectItem key={image} value={image}>
                        {image}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Choose a supported official image or enter a validated custom
                image below.
              </p>
              <Input
                value={customImage}
                onChange={(event) => setCustomImage(event.target.value)}
                placeholder="Custom image, e.g. ghcr.io/acme/postgres:17"
                className="border-border/40"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="db-name">Name</Label>
            <Input
              id="db-name"
              value={name}
              onChange={(e) => {
                handleNameChange(e.target.value);
                if (formErrors.name)
                  setFormErrors((prev) => ({ ...prev, name: "" }));
              }}
              placeholder="e.g. users-db"
              autoComplete="off"
              className="border-border/40 focus:border-primary"
            />
            {formErrors.name && (
              <span className="text-[10px] text-destructive">
                {formErrors.name}
              </span>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="db-service-name">Docker Swarm Service Name</Label>
            <Input
              id="db-service-name"
              value={appName}
              onChange={(e) => {
                setAppName(e.target.value);
                if (formErrors.appName)
                  setFormErrors((prev) => ({ ...prev, appName: "" }));
              }}
              placeholder="e.g. users-db"
              autoComplete="off"
              className="border-border/40 focus:border-primary"
            />
            {formErrors.appName && (
              <span className="text-[10px] text-destructive">
                {formErrors.appName}
              </span>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="db-server">Target Server</Label>
            <Select
              items={[
                ...(!isCloud
                  ? [{ value: "local", label: "Local Server (Leader)" }]
                  : []),
                ...(servers ?? [])
                  .filter(
                    (server) =>
                      server.status === "ready" &&
                      (server.serverType === "deploy" ||
                        server.serverType === "database"),
                  )
                  .map((server) => ({
                    value: server.id,
                    label: `${server.name} (${server.ipAddress})`,
                  })),
              ]}
              value={serverId}
              onValueChange={(value) => value && setServerId(value)}
            >
              <SelectTrigger id="db-server">
                <SelectValue
                  placeholder={isCloud ? "Select Server" : "Local Server"}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {!isCloud && (
                    <SelectItem value="local">Local Server (Leader)</SelectItem>
                  )}
                  {servers
                    ?.filter(
                      (server) =>
                        server.status === "ready" &&
                        (server.serverType === "deploy" ||
                          server.serverType === "database"),
                    )
                    ?.map((server) => (
                      <SelectItem key={server.id} value={server.id}>
                        {server.name} ({server.ipAddress})
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Select which server node in your cluster to deploy this database
              on.
            </p>
          </div>

          <div className="space-y-3 rounded-xl border border-border/30 bg-muted/10 p-4">
            <div>
              <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                Published Ports
              </h3>
              <p className="mt-1 text-muted-foreground text-xs">
                Leave blank to use the engine default. libSQL publishes HTTP
                8080, gRPC 5001, and admin 5000 inside the container.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="db-external-port">
                  {dbType === "libsql" ? "HTTP port" : "External port"}
                </Label>
                <Input
                  id="db-external-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={externalPort}
                  onChange={(event) => setExternalPort(event.target.value)}
                  placeholder={dbType === "libsql" ? "8080" : "Auto"}
                  className="border-border/40"
                />
              </div>
              {dbType === "libsql" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="db-libsql-grpc-port">gRPC port</Label>
                    <Input
                      id="db-libsql-grpc-port"
                      type="number"
                      min={1}
                      max={65535}
                      value={libsqlGrpcPort}
                      onChange={(event) =>
                        setLibsqlGrpcPort(event.target.value)
                      }
                      placeholder="5001"
                      className="border-border/40"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="db-libsql-admin-port">Admin port</Label>
                    <Input
                      id="db-libsql-admin-port"
                      type="number"
                      min={1}
                      max={65535}
                      value={libsqlAdminPort}
                      onChange={(event) =>
                        setLibsqlAdminPort(event.target.value)
                      }
                      placeholder="5000"
                      className="border-border/40"
                    />
                  </div>
                </>
              )}
            </div>
            {formErrors.libsqlPorts && (
              <span className="text-[10px] text-destructive">
                {formErrors.libsqlPorts}
              </span>
            )}
          </div>

          {/* Credentials Fields based on DB Type */}
          <div className="space-y-4 rounded-xl border border-border/30 bg-muted/10 p-4">
            <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
              Database Credentials Configuration
            </h3>

            {dbType !== "redis" && (
              <div className="space-y-2">
                <Label htmlFor="db-user">
                  {dbType === "mongodb" ? "Root Username" : "Database Username"}
                </Label>
                <Input
                  id="db-user"
                  value={dbUser}
                  onChange={(e) => {
                    setDbUser(e.target.value);
                    if (formErrors.dbUser)
                      setFormErrors((prev) => ({ ...prev, dbUser: "" }));
                  }}
                  placeholder="e.g. admin"
                  autoComplete="off"
                  className="border-border/40 bg-muted/20 focus:border-primary"
                />
                {formErrors.dbUser && (
                  <span className="text-[10px] text-destructive">
                    {formErrors.dbUser}
                  </span>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="db-password">Password</Label>
              <div className="flex gap-2">
                <Input
                  id="db-password"
                  value={dbPassword}
                  onChange={(e) => {
                    setDbPassword(e.target.value);
                    if (formErrors.dbPassword)
                      setFormErrors((prev) => ({ ...prev, dbPassword: "" }));
                  }}
                  placeholder="Password"
                  autoComplete="off"
                  className="border-border/40 bg-muted/20 font-mono focus:border-primary"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDbPassword(generatePassword())}
                  className="h-9 shrink-0 cursor-pointer px-3 text-xs"
                >
                  Regen
                </Button>
              </div>
              {formErrors.dbPassword && (
                <span className="text-[10px] text-destructive">
                  {formErrors.dbPassword}
                </span>
              )}
            </div>

            {(dbType === "mysql" || dbType === "mariadb") && (
              <div className="space-y-2">
                <Label htmlFor="db-root-password">Root Password</Label>
                <div className="flex gap-2">
                  <Input
                    id="db-root-password"
                    value={dbRootPassword}
                    onChange={(e) => {
                      setDbRootPassword(e.target.value);
                      if (formErrors.dbRootPassword)
                        setFormErrors((prev) => ({
                          ...prev,
                          dbRootPassword: "",
                        }));
                    }}
                    placeholder="Root Password"
                    autoComplete="off"
                    className="border-border/40 bg-muted/20 font-mono focus:border-primary"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDbRootPassword(generatePassword())}
                    className="h-9 shrink-0 cursor-pointer px-3 text-xs"
                  >
                    Regen
                  </Button>
                </div>
                {formErrors.dbRootPassword && (
                  <span className="text-[10px] text-destructive">
                    {formErrors.dbRootPassword}
                  </span>
                )}
              </div>
            )}

            {dbType !== "redis" && dbType !== "mongodb" && (
              <div className="space-y-2">
                <Label htmlFor="db-catalog-name">Database Name</Label>
                <Input
                  id="db-catalog-name"
                  value={dbName}
                  onChange={(e) => {
                    setDbName(e.target.value);
                    if (formErrors.dbName)
                      setFormErrors((prev) => ({ ...prev, dbName: "" }));
                  }}
                  placeholder="e.g. app_db"
                  autoComplete="off"
                  className="border-border/40 bg-muted/20 focus:border-primary"
                />
                {formErrors.dbName && (
                  <span className="text-[10px] text-destructive">
                    {formErrors.dbName}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="db-desc">Description</Label>
            <Input
              id="db-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="DB description (optional)"
              autoComplete="off"
              className="border-border/40 focus:border-primary"
            />
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="font-medium"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Deploying..." : "Deploy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateComposeDialog({
  open,
  onOpenChange,
  environmentId,
  projectName,
  organizationId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  environmentId: string;
  projectName: string;
  organizationId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [appName, setAppName] = useState("");
  const [composeType, setComposeType] = useState<"stack" | "compose">(
    "compose",
  );
  const [description, setDescription] = useState("");
  const { isCloud } = useSystemConfig();
  const [serverId, setServerId] = useState(() => (isCloud ? "" : "local"));

  useEffect(() => {
    setServerId(isCloud ? "" : "local");
  }, [isCloud]);

  const { data: servers = [] } = useQuery({
    ...trpc.server.list.queryOptions({ organizationId }),
    enabled: Boolean(organizationId),
  });

  const handleNameChange = (val: string) => {
    setName(val);
    const prefix = projectName
      ? `${projectName.toLowerCase().replace(/[^a-z0-9]/g, "-")}-`
      : "";
    const suffix = val.toLowerCase().replace(/[^a-z0-9]/g, "-");
    setAppName(prefix + suffix);
  };

  const mutation = useMutation({
    ...trpc.resource.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Docker Compose service created");
      setName("");
      setAppName("");
      setDescription("");
      setServerId(isCloud ? "" : "local");
      onOpenChange(false);
      onCreated();
    },
    onError: (err) =>
      toast.error(err.message || "Failed to create compose service"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="no-scrollbar max-h-[90svh] w-[calc(100vw-1rem)] max-w-[min(96vw,48rem)] sm:min-w-xl">
        <DialogHeader>
          <DialogTitle className="font-bold text-xl">
            New Docker Compose
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            Deploy a multi-container stack or Docker Compose service.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && appName.trim()) {
              if (isCloud && (!serverId || serverId === "local")) {
                toast.error("Please select a target server for deployment.");
                return;
              }
              mutation.mutate({
                environmentId,
                name: name.trim(),
                type: "compose",
                appName: appName.trim(),
                composeType,
                description: description.trim() || undefined,
                serverId: serverId === "local" ? undefined : serverId,
              });
            }
          }}
          className="space-y-4 pt-2"
        >
          <ResourceNameFields
            nameId="comp-name"
            serviceNameId="comp-service-name"
            serviceLabel="Docker Swarm Stack / App Name"
            placeholder="e.g. monitoring-stack"
            name={name}
            appName={appName}
            onNameChange={handleNameChange}
            onAppNameChange={setAppName}
          />
          <TargetServerField
            id="comp-server"
            serverId={serverId}
            isCloud={isCloud}
            servers={servers}
            onServerChange={setServerId}
            description="Select which server node in your cluster to deploy this Compose stack on."
          />

          <div className="space-y-2">
            <Label htmlFor="comp-type">Compose Format</Label>
            <Select
              items={[
                { value: "compose", label: "Standard Docker Compose" },
                { value: "stack", label: "Docker Swarm Stack" },
              ]}
              value={composeType}
              onValueChange={(value) => {
                if (value === "stack" || value === "compose") {
                  setComposeType(value);
                }
              }}
            >
              <SelectTrigger id="comp-type">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="compose">Standard Docker Compose</SelectItem>
                <SelectItem value="stack">Docker Swarm Stack</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="comp-desc">Description</Label>
            <Input
              id="comp-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Stack description (optional)"
              autoComplete="off"
              className="border-border/40 focus:border-primary"
            />
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="font-medium"
              disabled={mutation.isPending || !name.trim() || !appName.trim()}
            >
              {mutation.isPending ? "Deploying..." : "Deploy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete Resource Dialog ────────────────────────────────────────────────────

function DeleteResourceDialog({
  open,
  onOpenChange,
  resource,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resource: { id: string; name: string } | null;
  onDeleted: () => void;
}) {
  const [deleteVolumes, setDeleteVolumes] = useState(false);

  useEffect(() => {
    if (open) {
      setDeleteVolumes(false);
    }
  }, [open]);

  const mutation = useMutation({
    ...trpc.resource.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("Resource deleted successfully");
      onOpenChange(false);
      onDeleted();
    },
    onError: (err) => toast.error(err.message || "Failed to delete resource"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border border-destructive/30 bg-card shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-bold text-destructive text-xl">
            <HugeiconsIcon icon={Alert02Icon} className="size-5" />
            Delete Resource
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm">
            Are you sure you want to delete{" "}
            <span className="font-semibold text-foreground">
              {resource?.name}
            </span>
            ? This action is permanent and will stop any running instances.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center space-x-2 py-2">
          <Checkbox
            id="env-delete-volumes"
            checked={deleteVolumes}
            onCheckedChange={(checked) => setDeleteVolumes(!!checked)}
          />
          <label
            htmlFor="env-delete-volumes"
            className="cursor-pointer select-none font-medium text-foreground text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Remove associated volumes
          </label>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={mutation.isPending}
            className="gap-2"
            onClick={() => {
              if (resource) {
                mutation.mutate({ id: resource.id, deleteVolumes });
              }
            }}
          >
            {mutation.isPending && <Spinner className="size-4" />}
            Delete Resource
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Detail ───────────────────────────────────────────────────────────────

export default function EnvironmentDetail({
  projectId,
  environmentId,
}: {
  projectId: string;
  environmentId: string;
  session: typeof authClient.$Infer.Session;
}) {
  const router = useRouter();
  const [createAppOpen, setCreateAppOpen] = useState(false);
  const [createDbOpen, setCreateDbOpen] = useState(false);
  const [createComposeOpen, setCreateComposeOpen] = useState(false);
  const [deleteResOpen, setDeleteResOpen] = useState(false);
  const [selectedRes, setSelectedRes] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [targetEnvironmentId, setTargetEnvironmentId] = useState("");
  const [secretSyncOpen, setSecretSyncOpen] = useState(false);
  const [secretRotationOpen, setSecretRotationOpen] = useState(false);
  const [secretHistoryOpen, setSecretHistoryOpen] = useState(false);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [cloneNameInput, setCloneNameInput] = useState("");
  const [diffDialogOpen, setDiffDialogOpen] = useState(false);
  const [diffResult, setDiffResult] = useState<{
    variablesCount: number;
    resourcesCount: number;
  } | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [promoteDialogOpen, setPromoteDialogOpen] = useState(false);
  const [includeSecretsInPromote, setIncludeSecretsInPromote] = useState(false);

  // Fetch project
  const { data: project } = useQuery({
    ...trpc.project.get.queryOptions({ id: projectId }),
  });
  const { data: servers = [] } = useQuery({
    ...trpc.server.list.queryOptions({
      organizationId: project?.organizationId ?? "",
    }),
    enabled: Boolean(project?.organizationId),
  });

  // Fetch environment details
  const { data: env, isPending: loadingEnv } = useQuery({
    ...trpc.environment.get.queryOptions({ id: environmentId }),
  });
  const { data: environments = [] } = useQuery({
    ...trpc.environment.list.queryOptions({ projectId }),
  });

  // Fetch resources
  const {
    data: resources,
    isPending: loadingResources,
    refetch: refetchResources,
  } = useQuery({
    ...trpc.resource.list.queryOptions({ environmentId }),
  });

  // Delete environment mutation
  const deleteEnvMutation = useMutation({
    ...trpc.environment.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("Environment deleted successfully");
      router.push(`/projects/${projectId}` as Route);
    },
    onError: (err) =>
      toast.error(err.message || "Failed to delete environment"),
  });

  const queryClient = useQueryClient();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [envList, setEnvList] = useState<Array<{ key: string; value: string }>>(
    [],
  );

  const updateEnvMutation = useMutation({
    ...trpc.environment.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Project environment variables saved successfully");
      void queryClient.invalidateQueries({
        queryKey: trpc.environment.get.queryKey({ id: environmentId }),
      });
    },
    onError: (err) =>
      toast.error(
        err.message || "Failed to update project environment variables",
      ),
  });
  const cloneEnvironmentMutation = useMutation({
    ...trpc.environment.clone.mutationOptions(),
    onSuccess: (created) => {
      toast.success(`Cloned environment ${created.name}`);
      router.push(`/projects/${projectId}/${created.id}` as Route);
    },
    onError: (err) => toast.error(err.message || "Failed to clone environment"),
  });
  const promoteEnvironmentMutation = useMutation({
    ...trpc.environment.promote.mutationOptions(),
    onSuccess: () => toast.success("Environment promoted successfully"),
    onError: (err) =>
      toast.error(err.message || "Failed to promote environment"),
  });

  useEffect(() => {
    if (env?.envVars) {
      setEnvList(recordToKeyValuePairs(env.envVars));
    } else {
      setEnvList([]);
    }
  }, [env?.envVars]);

  if (loadingEnv) {
    return (
      <div className="flex min-h-60 items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (!env || !project) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-7xl space-y-4 overflow-x-hidden px-4 py-8 text-center">
        <p className="text-muted-foreground">Environment not found.</p>
        <Link href={`/projects/${projectId}` as Route}>
          <Button variant="outline">Back to Project</Button>
        </Link>
      </div>
    );
  }

  const filteredResources =
    resources?.filter((resource) =>
      resource.name.toLowerCase().includes(searchQuery.toLowerCase()),
    ) ?? [];

  const hasResources = (resources?.length ?? 0) > 0;
  const isDefaultEnv = env.isDefault || env.isProtected;

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-8 overflow-x-hidden px-4 py-8 md:px-8">
      {/* Breadcrumbs / Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <Link
            href={"/projects" as Route}
            className="transition-colors hover:text-primary"
          >
            Projects
          </Link>
          <HugeiconsIcon icon={ArrowRight01Icon} className="size-3" />
          <Link
            href={`/projects/${projectId}` as Route}
            className="transition-colors hover:text-primary"
          >
            {project.name}
          </Link>
          <HugeiconsIcon icon={ArrowRight01Icon} className="size-3" />
          <span className="font-medium text-foreground">{env.name}</span>
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="font-bold text-2xl text-foreground">
              {env.name} Environment
            </h1>
            <p className="text-muted-foreground text-sm">
              Deploy and manage apps, databases, and microservices.
            </p>
          </div>
          <div className="flex flex-row gap-2">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search resources…"
              className="w-full min-w-0 flex-1 sm:w-64"
            />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button>
                    <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
                    New Resource
                  </Button>
                }
              />
              <DropdownMenuContent
                align="end"
                className="w-48 border border-border/45 bg-card shadow-xl"
              >
                <DropdownMenuItem onClick={() => setCreateAppOpen(true)}>
                  <HugeiconsIcon
                    icon={ComputerIcon}
                    className="mr-2 size-4 text-primary"
                  />
                  Application
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setCreateDbOpen(true)}>
                  <HugeiconsIcon
                    icon={DatabaseIcon}
                    className="mr-2 size-4 text-warning"
                  />
                  Database
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setCreateComposeOpen(true)}>
                  <HugeiconsIcon
                    icon={ServerStack01Icon}
                    className="mr-2 size-4 text-info"
                  />
                  Docker Compose
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              onClick={() => {
                setCloneNameInput(`${env?.name || ""}-copy`);
                setCloneDialogOpen(true);
              }}
              disabled={cloneEnvironmentMutation.isPending}
            >
              Clone
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="resources" className="min-w-0 space-y-6">
        <TabsList className="scrollbar-thin w-full max-w-full justify-start gap-1">
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="env-vars">Shared Variables</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="resources" className="outline-none">
          {loadingResources ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="size-6" />
            </div>
          ) : filteredResources.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredResources.map((res) => (
                <ResourceCard
                  key={res.id}
                  projectId={projectId}
                  environmentId={environmentId}
                  resource={res}
                  serverName={
                    servers.find((server) => server.id === res.serverId)
                      ?.name ??
                    (res.serverId === "local"
                      ? "Local Docker"
                      : res.serverId === "manager"
                        ? "Swarm manager"
                        : "Not assigned")
                  }
                  onDelete={() => {
                    setSelectedRes(res);
                    setDeleteResOpen(true);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              No resources found in this environment.
            </div>
          )}
        </TabsContent>

        <TabsContent value="env-vars" className="outline-none">
          <div className="max-w-4xl space-y-6">
            <Card className="border border-border/40 bg-card/20">
              <CardHeader>
                <CardTitle className="font-semibold text-lg">
                  Project Environment Variables
                </CardTitle>
                <CardDescription className="text-muted-foreground text-sm">
                  Configure shared environment variables accessible to all
                  resources in the <strong>{env.name}</strong> environment.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 border-border/20 border-t pt-4">
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-primary text-xs leading-relaxed">
                  <p className="mb-1 font-semibold text-sm">
                    How to reference in service environments:
                  </p>
                  To use these variables in your service environments, reference
                  them using the syntax:
                  <code className="mx-1 rounded border border-border/20 bg-background/50 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                    {"DATABASE_URL=$" + "{{project.DATABASE_URL}}"}
                  </code>
                  . They will be resolved and replaced dynamically during
                  deployment.
                </div>

                <KeyValueEditor
                  value={envList}
                  onChange={setEnvList}
                  addLabel="Add shared variable"
                />

                <div className="flex justify-end border-border/20 border-t pt-4">
                  <Button
                    onClick={() => {
                      updateEnvMutation.mutate({
                        id: environmentId,
                        envVars: keyValuePairsToRecord(envList),
                      });
                    }}
                    disabled={updateEnvMutation.isPending}
                    className="gap-2"
                  >
                    {updateEnvMutation.isPending && (
                      <Spinner className="size-4" />
                    )}
                    Save Environment Variables
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Secret Engine & Version Automation Card */}
            <Card className="border border-border/40 bg-card/20">
              <CardHeader>
                <CardTitle className="font-semibold text-lg">
                  Secret Engine Integrations & Automation
                </CardTitle>
                <CardDescription className="text-muted-foreground text-sm">
                  Sync runtime environment variables from external secret
                  managers (HashiCorp Vault, AWS Secrets Manager, 1Password),
                  audit secret version history, or schedule automatic key
                  rotations.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 border-border/20 border-t pt-4 sm:grid-cols-3">
                <div className="flex flex-col justify-between rounded-lg border bg-background/50 p-3.5">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-medium text-xs">
                      <HugeiconsIcon
                        icon={RefreshIcon}
                        className="size-4 text-primary"
                      />
                      Sync External Secrets
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Import key-value secrets from connected Vault, AWS Secrets
                      Manager, or 1Password engines.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3 h-8 w-full text-xs"
                    onClick={() => setSecretSyncOpen(true)}
                  >
                    Sync Provider
                  </Button>
                </div>

                <div className="flex flex-col justify-between rounded-lg border bg-background/50 p-3.5">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-medium text-xs">
                      <HugeiconsIcon
                        icon={Clock01Icon}
                        className="size-4 text-primary"
                      />
                      Rotation Schedules
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Configure recurring key rotation intervals or trigger
                      immediate on-demand key rotation.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3 h-8 w-full text-xs"
                    onClick={() => setSecretRotationOpen(true)}
                  >
                    Manage Rotation
                  </Button>
                </div>

                <div className="flex flex-col justify-between rounded-lg border bg-background/50 p-3.5">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-medium text-xs">
                      <HugeiconsIcon
                        icon={Key01Icon}
                        className="size-4 text-primary"
                      />
                      Version History
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Audit historical secret version snapshots and execute
                      one-click version rollbacks.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3 h-8 w-full text-xs"
                    onClick={() => setSecretHistoryOpen(true)}
                  >
                    View History
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="outline-none">
          <div className="max-w-2xl space-y-6">
            <Card className="border border-border/40 bg-card/20">
              <CardHeader>
                <CardTitle className="font-semibold text-lg">
                  Environment workflows
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                  Inherit shared variables, compare environments, or promote a
                  tested configuration.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 border-border/20">
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={() =>
                      updateEnvMutation.mutate({
                        id: environmentId,
                        inheritsVariables: !env.inheritsVariables,
                      })
                    }
                    disabled={updateEnvMutation.isPending}
                  >
                    {env.inheritsVariables
                      ? "Disable variable inheritance"
                      : "Enable variable inheritance"}
                  </Button>
                  <span className="text-muted-foreground text-xs">
                    {env.inheritsVariables
                      ? "Inherited variables are resolved during deployment."
                      : "This environment uses only its own variables."}
                  </span>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select
                    value={targetEnvironmentId}
                    onValueChange={(value) =>
                      setTargetEnvironmentId(value ?? "")
                    }
                  >
                    <SelectTrigger className="sm:w-64">
                      <SelectValue placeholder="Target environment" />
                    </SelectTrigger>
                    <SelectContent>
                      {environments
                        .filter((candidate) => candidate.id !== environmentId)
                        .map((candidate) => (
                          <SelectItem key={candidate.id} value={candidate.id}>
                            {candidate.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    disabled={!targetEnvironmentId || loadingDiff}
                    onClick={async () => {
                      setLoadingDiff(true);
                      try {
                        const diff = await queryClient.fetchQuery(
                          trpc.environment.diff.queryOptions({
                            sourceEnvironmentId: environmentId,
                            targetEnvironmentId,
                          }),
                        );
                        setDiffResult({
                          variablesCount: diff.variables.length,
                          resourcesCount: diff.resources.filter(
                            (entry: EnvironmentDiff["resources"][number]) =>
                              entry.changed,
                          ).length,
                        });
                        setDiffDialogOpen(true);
                      } catch (error: unknown) {
                        toast.error(
                          errorMessage(error) ||
                            "Failed to compare environments",
                        );
                      } finally {
                        setLoadingDiff(false);
                      }
                    }}
                  >
                    {loadingDiff && <Spinner data-icon="inline-start" />}
                    Compare
                  </Button>
                  <Button
                    disabled={
                      !targetEnvironmentId ||
                      promoteEnvironmentMutation.isPending
                    }
                    onClick={() => {
                      setIncludeSecretsInPromote(false);
                      setPromoteDialogOpen(true);
                    }}
                  >
                    Promote
                  </Button>
                </div>
              </CardContent>
            </Card>
            <DangerZoneCard
              title="Delete Environment"
              description="Permanently delete this environment. This will stop and delete all services running under this environment."
              actionLabel="Delete Environment"
              onAction={() => setDeleteDialogOpen(true)}
              disabled={isDefaultEnv || hasResources}
              pending={deleteEnvMutation.isPending}
              warningText={
                isDefaultEnv
                  ? "The production/default environment is required and cannot be deleted."
                  : hasResources
                    ? "Please delete all resources inside this environment before attempting deletion."
                    : undefined
              }
              infoText={
                !isDefaultEnv && !hasResources
                  ? "This environment is empty and safe to delete."
                  : undefined
              }
            />
          </div>
        </TabsContent>
      </Tabs>

      <ConfirmActionDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Environment?"
        description={`Are you sure you want to delete "${env.name}"? All running containers and configuration in this environment will be permanently deleted.`}
        actionLabel="Delete Environment"
        requireConfirmText={true}
        pending={deleteEnvMutation.isPending}
        onConfirm={() => {
          deleteEnvMutation.mutate({ id: environmentId });
        }}
      />

      {/* Modals */}
      <CreateAppDialog
        open={createAppOpen}
        onOpenChange={setCreateAppOpen}
        environmentId={environmentId}
        projectName={project.name}
        organizationId={project.organizationId}
        onCreated={refetchResources}
      />

      <CreateDbDialog
        open={createDbOpen}
        onOpenChange={setCreateDbOpen}
        environmentId={environmentId}
        projectName={project.name}
        organizationId={project.organizationId}
        onCreated={refetchResources}
      />

      <CreateComposeDialog
        open={createComposeOpen}
        onOpenChange={setCreateComposeOpen}
        environmentId={environmentId}
        projectName={project.name}
        organizationId={project.organizationId}
        onCreated={refetchResources}
      />

      <DeleteResourceDialog
        open={deleteResOpen}
        onOpenChange={setDeleteResOpen}
        resource={selectedRes}
        onDeleted={refetchResources}
      />

      {project?.organizationId && (
        <>
          <SecretSyncDialog
            open={secretSyncOpen}
            onOpenChange={setSecretSyncOpen}
            organizationId={project.organizationId}
            scopeType="environment"
            scopeId={environmentId}
            onSuccess={() => {
              void queryClient.invalidateQueries({
                queryKey: trpc.environment.get.queryKey({ id: environmentId }),
              });
            }}
          />
          <SecretRotationDialog
            open={secretRotationOpen}
            onOpenChange={setSecretRotationOpen}
            organizationId={project.organizationId}
            scopeType="environment"
            scopeId={environmentId}
            onSuccess={() => {
              void queryClient.invalidateQueries({
                queryKey: trpc.environment.get.queryKey({ id: environmentId }),
              });
            }}
          />
          <SecretHistoryDialog
            open={secretHistoryOpen}
            onOpenChange={setSecretHistoryOpen}
            scopeType="environment"
            scopeId={environmentId}
            onSuccess={() => {
              void queryClient.invalidateQueries({
                queryKey: trpc.environment.get.queryKey({ id: environmentId }),
              });
            }}
          />

          {/* Clone Environment Dialog */}
          <Dialog open={cloneDialogOpen} onOpenChange={setCloneDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Clone Environment</DialogTitle>
                <DialogDescription>
                  Create a new environment cloned from{" "}
                  <strong>{env?.name}</strong>.
                </DialogDescription>
              </DialogHeader>
              <div className="py-2">
                <Label htmlFor="clone-env-name">Cloned Environment Name</Label>
                <Input
                  id="clone-env-name"
                  value={cloneNameInput}
                  onChange={(e) => setCloneNameInput(e.target.value)}
                  placeholder="e.g. staging-copy"
                  className="mt-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && cloneNameInput.trim()) {
                      e.preventDefault();
                      cloneEnvironmentMutation.mutate({
                        sourceEnvironmentId: environmentId,
                        name: cloneNameInput.trim(),
                        includeResources: true,
                        includeSecrets: false,
                      });
                      setCloneDialogOpen(false);
                    }
                  }}
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCloneDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  disabled={
                    !cloneNameInput.trim() || cloneEnvironmentMutation.isPending
                  }
                  onClick={() => {
                    if (cloneNameInput.trim()) {
                      cloneEnvironmentMutation.mutate({
                        sourceEnvironmentId: environmentId,
                        name: cloneNameInput.trim(),
                        includeResources: true,
                        includeSecrets: false,
                      });
                      setCloneDialogOpen(false);
                    }
                  }}
                >
                  {cloneEnvironmentMutation.isPending && (
                    <Spinner data-icon="inline-start" />
                  )}
                  Clone Environment
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Environment Comparison Summary Dialog */}
          <Dialog open={diffDialogOpen} onOpenChange={setDiffDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Environment Comparison</DialogTitle>
                <DialogDescription>
                  Summary of differences between <strong>{env?.name}</strong>{" "}
                  and the target environment.
                </DialogDescription>
              </DialogHeader>
              {diffResult && (
                <div className="grid grid-cols-2 gap-3 py-3">
                  <div className="rounded-lg border bg-card p-3 text-card-foreground shadow-xs">
                    <p className="font-medium text-muted-foreground text-xs">
                      Variables Changed
                    </p>
                    <p className="font-bold text-2xl">
                      {diffResult.variablesCount}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-card p-3 text-card-foreground shadow-xs">
                    <p className="font-medium text-muted-foreground text-xs">
                      Resources Changed
                    </p>
                    <p className="font-bold text-2xl">
                      {diffResult.resourcesCount}
                    </p>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button onClick={() => setDiffDialogOpen(false)}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Promote Environment Confirmation Modal */}
          <AlertDialog
            open={promoteDialogOpen}
            onOpenChange={setPromoteDialogOpen}
          >
            <AlertDialogContent className="sm:max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle>Promote Environment?</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to promote <strong>{env?.name}</strong>{" "}
                  to the selected environment?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="py-2">
                <label className="flex cursor-pointer items-center gap-2 font-medium text-sm">
                  <Checkbox
                    checked={includeSecretsInPromote}
                    onCheckedChange={(c) =>
                      setIncludeSecretsInPromote(Boolean(c))
                    }
                  />
                  <span>
                    Include environment and resource secrets in this promotion
                  </span>
                </label>
                <p className="mt-1 ml-6 text-muted-foreground text-xs">
                  Uncheck to promote environment configuration only.
                </p>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel
                  disabled={promoteEnvironmentMutation.isPending}
                >
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={promoteEnvironmentMutation.isPending}
                  onClick={() => {
                    promoteEnvironmentMutation.mutate(
                      {
                        sourceEnvironmentId: environmentId,
                        targetEnvironmentId,
                        includeResources: true,
                        includeSecrets: includeSecretsInPromote,
                      },
                      {
                        onSuccess: () => setPromoteDialogOpen(false),
                      },
                    );
                  }}
                >
                  {promoteEnvironmentMutation.isPending && (
                    <Spinner data-icon="inline-start" />
                  )}
                  Promote Environment
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
