import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
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
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@upstand/ui/components/field";
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
import { Switch } from "@upstand/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@upstand/ui/components/table";
import { useState } from "react";
import z from "zod";
import {
  ArchiveRestore,
  CalendarClock,
  Database,
  HardDrive,
  Loader2,
  Play,
  Plus,
  Trash2,
} from "@/components/huge-icons";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { trpc } from "@/utils/trpc";
import { useBackupSettings } from "../hooks/use-backup-settings";

const TIME_ZONE_OPTIONS =
  typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : ["UTC"];

type BackupKind = "database" | "volume";
type DatabaseEngine =
  | "postgres"
  | "mysql"
  | "mariadb"
  | "mongodb"
  | "libsql"
  | "redis";

type BackupSchedule = {
  id: string;
  destinationId: string;
  name: string;
  kind: BackupKind;
  cronExpression: string;
  timezone: string;
  prefix: string;
  retentionCount: number | null;
  enabled: boolean;
  databaseName: string | null;
  databaseEngine: DatabaseEngine | null;
  serviceName: string | null;
  volumeName: string | null;
  stopService: boolean;
  pointInTimeRecovery: boolean;
  restoreVerification: boolean;
  replicaCount: number;
  failoverEnabled: boolean;
};

type BackupRun = {
  id: string;
  scheduleId: string;
  kind: BackupKind;
  status: "queued" | "running" | "succeeded" | "failed";
  fileKey: string | null;
  error: string | null;
  createdAt: Date | string;
  completedAt: Date | string | null;
};

const STATUS_VARIANT: Record<
  BackupRun["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  queued: "outline",
  running: "secondary",
  succeeded: "default",
  failed: "destructive",
};

function defaultEngine(dbType?: string | null): DatabaseEngine {
  if (
    dbType === "mysql" ||
    dbType === "mariadb" ||
    dbType === "mongodb" ||
    dbType === "libsql" ||
    dbType === "redis"
  ) {
    return dbType;
  }
  return "postgres";
}

function makeForm(
  resource: { name: string; dbType?: string | null },
  schedule?: BackupSchedule,
) {
  return {
    name: schedule?.name ?? `${resource.name} backup`,
    destinationId: schedule?.destinationId ?? "",
    kind: schedule?.kind ?? "database",
    cronExpression: schedule?.cronExpression ?? "0 2 * * *",
    timezone:
      schedule?.timezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      "UTC",
    prefix: schedule?.prefix ?? "",
    retentionCount: schedule?.retentionCount?.toString() ?? "7",
    databaseName: schedule?.databaseName ?? "",
    databaseEngine: schedule?.databaseEngine ?? defaultEngine(resource.dbType),
    serviceName: schedule?.serviceName ?? "",
    volumeName: schedule?.volumeName ?? "",
    stopService: schedule?.stopService ?? false,
    pointInTimeRecovery: schedule?.pointInTimeRecovery ?? false,
    restoreVerification: schedule?.restoreVerification ?? true,
    replicaCount: schedule?.replicaCount?.toString() ?? "0",
    failoverEnabled: schedule?.failoverEnabled ?? false,
    databaseUser: "",
    databasePassword: "",
  };
}

export function BackupPanel({
  resource,
  organizationId,
}: {
  resource: { id: string; name: string; type: string; dbType?: string | null };
  organizationId: string;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<BackupSchedule | null>(
    null,
  );
  const [scheduleToDelete, setScheduleToDelete] =
    useState<BackupSchedule | null>(null);
  const [runToRestore, setRunToRestore] = useState<BackupRun | null>(null);

  const {
    schedules,
    schedulesPending,
    runs,
    runsPending,
    destinations,
    volumes,
    isVolumesFetching,
    refetchVolumes,
    createSchedule,
    isCreatingSchedule,
    updateSchedule,
    isUpdatingSchedule,
    deleteSchedule,
    isDeletingSchedule,
    runNow,
    isRunningNow,
    restoreRun,
    isRestoring,
  } = useBackupSettings({
    resourceId: resource.id,
    organizationId,
    onSuccessAction: () => setDialogOpen(false),
  });

  const { data: composeServices = [] } = useQuery({
    ...trpc.backup.listComposeServices.queryOptions({
      resourceId: resource.id,
    }),
    enabled: resource.type === "compose",
  });

  const form = useForm({
    defaultValues: makeForm(resource),
    onSubmit: async ({ value }) => {
      const sourceCredentials =
        value.databaseUser.trim() && value.databasePassword
          ? {
              databaseUser: value.databaseUser.trim(),
              databasePassword: value.databasePassword,
            }
          : undefined;

      const payload = {
        resourceId: resource.id,
        destinationId: value.destinationId,
        name: value.name.trim(),
        kind: value.kind,
        cronExpression: value.cronExpression.trim(),
        timezone: value.timezone.trim(),
        prefix: value.prefix.trim(),
        retentionCount: value.retentionCount
          ? Number(value.retentionCount)
          : null,
        enabled: true,
        databaseName:
          value.kind === "database"
            ? value.databaseName.trim() || undefined
            : undefined,
        databaseEngine:
          value.kind === "database" ? value.databaseEngine : undefined,
        serviceName: value.serviceName.trim() || undefined,
        volumeName:
          value.kind === "volume" ? value.volumeName.trim() : undefined,
        stopService:
          value.kind === "volume"
            ? value.stopService
            : value.pointInTimeRecovery,
        pointInTimeRecovery:
          value.kind === "database" && value.pointInTimeRecovery,
        restoreVerification: value.restoreVerification,
        replicaCount:
          value.kind === "database" ? Number(value.replicaCount || 0) : 0,
        failoverEnabled: value.kind === "database" && value.failoverEnabled,
        sourceCredentials,
      };

      if (editingSchedule) {
        updateSchedule({ ...payload, id: editingSchedule.id });
      } else {
        createSchedule(payload);
      }
    },
    validators: {
      onSubmit: ({ value }) => {
        if (!value.name) return "Name is required";
        if (!value.destinationId) return "Choose an S3 backup destination";
        if (!value.cronExpression) return "Cron expression is required";
        if (!value.timezone) return "Timezone is required";
        if (value.kind === "database") {
          if (
            !value.databaseName &&
            value.databaseEngine !== "libsql" &&
            value.databaseEngine !== "redis"
          )
            return "Database name is required";
        } else {
          if (!value.volumeName) return "Choose a Docker volume";
        }
        return undefined;
      },
    },
  });

  const openCreate = () => {
    setEditingSchedule(null);
    form.reset();
    setDialogOpen(true);
  };

  const openEdit = (schedule: BackupSchedule) => {
    setEditingSchedule(schedule);
    const initVals = makeForm(resource, schedule);
    form.reset(initVals);
    setDialogOpen(true);
  };

  const updating = isCreatingSchedule || isUpdatingSchedule;

  return (
    <div className="space-y-6">
      <Card className="border border-border/40 bg-card/20">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CalendarClock className="size-5 text-primary" /> Backup schedules
            </CardTitle>
            <CardDescription>
              Stream encrypted database dumps and volume archives to an
              S3-compatible destination. Schedules run in the selected timezone.
            </CardDescription>
          </div>
          <Button className="gap-2" onClick={openCreate}>
            <Plus className="size-4" /> Add backup
          </Button>
        </CardHeader>
        <CardContent>
          {schedulesPending ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : schedules.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground text-sm">
              No backup schedules. Create one to protect this resource.
            </p>
          ) : (
            <div className="space-y-3">
              {(schedules as BackupSchedule[]).map((schedule) => (
                <div
                  key={schedule.id}
                  className="flex flex-col gap-3 rounded-xl border border-border/50 p-4 lg:flex-row lg:items-center lg:justify-between"
                >
                  <button
                    type="button"
                    className="min-w-0 text-left"
                    onClick={() => openEdit(schedule)}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      {schedule.kind === "database" ? (
                        <Database className="size-4 text-primary" />
                      ) : (
                        <HardDrive className="size-4 text-primary" />
                      )}
                      {schedule.name}
                      <Badge variant={schedule.enabled ? "default" : "outline"}>
                        {schedule.enabled ? "Enabled" : "Paused"}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-muted-foreground text-xs">
                      {schedule.cronExpression} · {schedule.timezone} · keep{" "}
                      {schedule.retentionCount ?? "all"} backups
                    </p>
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      disabled={isRunningNow}
                      onClick={() => runNow({ scheduleId: schedule.id })}
                    >
                      {isRunningNow ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Play className="size-3" />
                      )}{" "}
                      Run now
                    </Button>
                    <div className="flex items-center gap-2 px-1 text-muted-foreground text-xs">
                      <Switch
                        checked={schedule.enabled}
                        aria-label={`Toggle ${schedule.name}`}
                        onCheckedChange={(enabled) =>
                          updateSchedule({ id: schedule.id, enabled })
                        }
                      />
                      {schedule.enabled ? "On" : "Off"}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${schedule.name}`}
                      onClick={() => setScheduleToDelete(schedule)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border border-border/40 bg-card/20">
        <CardHeader>
          <CardTitle className="text-lg">Backup history</CardTitle>
          <CardDescription>
            Every backup is recorded before execution, so queued, failed, and
            completed runs remain auditable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runsPending ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : runs.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground text-sm">
              No backup runs yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Artifact / error</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(runs as BackupRun[]).map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="capitalize">{run.kind}</TableCell>
                      <TableCell>
                        <Badge
                          variant={STATUS_VARIANT[run.status]}
                          className="capitalize"
                        >
                          {run.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                        {new Date(run.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell
                        className="max-w-80 truncate font-mono text-xs"
                        title={run.error ?? run.fileKey ?? undefined}
                      >
                        {run.error ?? run.fileKey ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {run.status === "succeeded" && run.fileKey ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => setRunToRestore(run)}
                          >
                            <ArchiveRestore className="size-3" /> Restore
                          </Button>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="no-scrollbar max-h-[90vh] max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingSchedule
                ? "Edit backup schedule"
                : "Create backup schedule"}
            </DialogTitle>
            <DialogDescription>
              Backup data is streamed directly to the selected destination.
              Stored destination and source credentials remain encrypted at
              rest.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
          >
            <FieldGroup>
              <form.Field
                name="name"
                validators={{
                  onChange: z.string().min(1, "Name is required"),
                }}
              >
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                    <Input
                      id={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <form.Field name="kind">
                  {(field) => (
                    <Field>
                      <FieldLabel>Backup type</FieldLabel>
                      <Select
                        items={[
                          { value: "database", label: "Database dump" },
                          { value: "volume", label: "Docker volume archive" },
                        ]}
                        value={field.state.value}
                        onValueChange={(value) =>
                          field.handleChange(value as BackupKind)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="database">
                            Database dump
                          </SelectItem>
                          <SelectItem value="volume">
                            Docker volume archive
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                </form.Field>

                <form.Field
                  name="destinationId"
                  validators={{
                    onChange: z
                      .string()
                      .min(1, "Choose an S3 backup destination"),
                  }}
                >
                  {(field) => (
                    <Field>
                      <FieldLabel>Destination</FieldLabel>
                      <Select
                        items={destinations.map((destination) => ({
                          value: destination.id,
                          label: `${destination.name} (${destination.bucket})`,
                        }))}
                        value={field.state.value}
                        onValueChange={(value) =>
                          field.handleChange(value || "")
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a destination" />
                        </SelectTrigger>
                        <SelectContent>
                          {destinations.map((destination) => (
                            <SelectItem
                              key={destination.id}
                              value={destination.id}
                            >
                              {destination.name} ({destination.bucket})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {destinations.length === 0 && (
                        <p className="mt-1 text-muted-foreground text-xs">
                          Create an S3 destination in workspace settings first.
                        </p>
                      )}
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  )}
                </form.Field>
              </div>

              <form.Subscribe
                selector={(state) => ({
                  destinationId: state.values.destinationId,
                  prefix: state.values.prefix,
                })}
              >
                {({ destinationId, prefix }) => {
                  const selectedDestination = destinations.find(
                    (destination) => destination.id === destinationId,
                  );

                  if (!selectedDestination) return null;

                  return (
                    <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground text-xs">
                      Writing to {selectedDestination.bucket}/
                      {prefix || "resource-id/"} via {selectedDestination.name}.
                    </p>
                  );
                }}
              </form.Subscribe>

              <div className="grid gap-4 sm:grid-cols-3">
                <form.Field
                  name="cronExpression"
                  validators={{
                    onChange: z.string().min(1, "Cron expression is required"),
                  }}
                >
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name}>
                        Cron expression
                      </FieldLabel>
                      <Input
                        id={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="0 2 * * *"
                      />
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  )}
                </form.Field>

                <form.Field
                  name="timezone"
                  validators={{
                    onChange: z.string().min(1, "Timezone is required"),
                  }}
                >
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name}>Timezone</FieldLabel>
                      <SearchableSelect
                        value={field.state.value}
                        options={TIME_ZONE_OPTIONS}
                        onValueChange={(timezone) =>
                          field.handleChange(timezone)
                        }
                        placeholder="Search time zones"
                        ariaLabel="Backup timezone"
                      />
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  )}
                </form.Field>

                <form.Field name="retentionCount">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor={field.name}>Keep latest</FieldLabel>
                      <Input
                        id={field.name}
                        type="number"
                        min="1"
                        max="3650"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </Field>
                  )}
                </form.Field>
              </div>

              <form.Field name="prefix">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>
                      Path prefix (optional)
                    </FieldLabel>
                    <Input
                      id={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="production"
                    />
                  </Field>
                )}
              </form.Field>

              <form.Subscribe selector={(state) => state.values.kind}>
                {(kind) =>
                  kind === "database" ? (
                    <>
                      <div className="grid gap-4 sm:grid-cols-3">
                        <form.Field name="databaseEngine">
                          {(field) => (
                            <Field>
                              <FieldLabel>Engine</FieldLabel>
                              <Select
                                items={[
                                  { value: "postgres", label: "PostgreSQL" },
                                  { value: "mysql", label: "MySQL" },
                                  { value: "mariadb", label: "MariaDB" },
                                  { value: "mongodb", label: "MongoDB" },
                                  { value: "libsql", label: "libSQL" },
                                  { value: "redis", label: "Redis" },
                                ]}
                                value={field.state.value}
                                onValueChange={(value) =>
                                  field.handleChange(value as DatabaseEngine)
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="postgres">
                                    PostgreSQL
                                  </SelectItem>
                                  <SelectItem value="mysql">MySQL</SelectItem>
                                  <SelectItem value="mariadb">
                                    MariaDB
                                  </SelectItem>
                                  <SelectItem value="mongodb">
                                    MongoDB
                                  </SelectItem>
                                  <SelectItem value="libsql">libSQL</SelectItem>
                                  <SelectItem value="redis">Redis</SelectItem>
                                </SelectContent>
                              </Select>
                            </Field>
                          )}
                        </form.Field>

                        <form.Field
                          name="databaseName"
                          validators={{
                            onChange: z
                              .string()
                              .min(1, "Database name is required"),
                          }}
                        >
                          {(field) => (
                            <Field>
                              <FieldLabel htmlFor={field.name}>
                                Database name
                              </FieldLabel>
                              <Input
                                id={field.name}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(e) =>
                                  field.handleChange(e.target.value)
                                }
                              />
                              <FieldError errors={field.state.meta.errors} />
                            </Field>
                          )}
                        </form.Field>

                        <form.Field name="serviceName">
                          {(field) => (
                            <Field>
                              <FieldLabel htmlFor={field.name}>
                                Compose service
                              </FieldLabel>
                              {composeServices.length > 0 ? (
                                <Select
                                  items={[
                                    {
                                      value: "__resource_default__",
                                      label: "Resource default",
                                    },
                                    ...composeServices.map((service) => ({
                                      value: service,
                                      label: service,
                                    })),
                                  ]}
                                  value={
                                    field.state.value || "__resource_default__"
                                  }
                                  onValueChange={(value) =>
                                    field.handleChange(
                                      !value || value === "__resource_default__"
                                        ? ""
                                        : value,
                                    )
                                  }
                                >
                                  <SelectTrigger id={field.name}>
                                    <SelectValue placeholder="Resource default" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__resource_default__">
                                      Resource default
                                    </SelectItem>
                                    {composeServices.map((service) => (
                                      <SelectItem key={service} value={service}>
                                        {service}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Input
                                  id={field.name}
                                  value={field.state.value}
                                  onBlur={field.handleBlur}
                                  onChange={(e) =>
                                    field.handleChange(e.target.value)
                                  }
                                  placeholder="postgres"
                                />
                              )}
                            </Field>
                          )}
                        </form.Field>
                      </div>

                      {resource.type === "compose" && (
                        <div className="grid gap-4 rounded-lg border border-border/50 p-4 sm:grid-cols-2">
                          <form.Field name="databaseUser">
                            {(field) => (
                              <Field>
                                <FieldLabel htmlFor={field.name}>
                                  Database user
                                </FieldLabel>
                                <Input
                                  id={field.name}
                                  value={field.state.value}
                                  onBlur={field.handleBlur}
                                  onChange={(e) =>
                                    field.handleChange(e.target.value)
                                  }
                                />
                              </Field>
                            )}
                          </form.Field>

                          <form.Field name="databasePassword">
                            {(field) => (
                              <Field>
                                <FieldLabel htmlFor={field.name}>
                                  Database password
                                </FieldLabel>
                                <Input
                                  id={field.name}
                                  type="password"
                                  value={field.state.value}
                                  onBlur={field.handleBlur}
                                  onChange={(e) =>
                                    field.handleChange(e.target.value)
                                  }
                                />
                              </Field>
                            )}
                          </form.Field>
                          <p className="text-muted-foreground text-xs sm:col-span-2">
                            Compose resources require source database
                            credentials. Leave these blank when editing to
                            preserve the saved encrypted credentials.
                          </p>
                        </div>
                      )}
                      <div className="flex flex-col gap-3 rounded-2xl border border-border/50 p-4 sm:grid-cols-2">
                        <form.Field name="restoreVerification">
                          {(field) => (
                            <Label className="flex items-center gap-3 text-xs">
                              <Switch
                                checked={field.state.value}
                                onCheckedChange={(value) =>
                                  field.handleChange(value)
                                }
                              />
                              Verify the restore in an isolated database after
                              each backup
                            </Label>
                          )}
                        </form.Field>
                        <form.Subscribe
                          selector={(state) => state.values.databaseEngine}
                        >
                          {(engine) =>
                            engine === "postgres" && (
                              <>
                                <form.Field name="pointInTimeRecovery">
                                  {(field) => (
                                    <Label className="flex items-center gap-3 text-xs">
                                      <Switch
                                        checked={field.state.value}
                                        onCheckedChange={(value) =>
                                          field.handleChange(value)
                                        }
                                      />
                                      Enable PostgreSQL point-in-time recovery
                                      (requires WAL-G)
                                    </Label>
                                  )}
                                </form.Field>
                                <form.Field name="replicaCount">
                                  {(field) => (
                                    <Field className="gap-0">
                                      <FieldLabel>Managed replicas</FieldLabel>
                                      <p className="text-muted-foreground text-xs">
                                        Configure the operational replica policy
                                        under Advanced → Health & Deploy.
                                      </p>
                                      <Input
                                        type="number"
                                        min="0"
                                        max="9"
                                        className="mt-2"
                                        value={field.state.value}
                                        onChange={(event) =>
                                          field.handleChange(event.target.value)
                                        }
                                      />
                                    </Field>
                                  )}
                                </form.Field>
                                <form.Field name="failoverEnabled">
                                  {(field) => (
                                    <Label className="flex items-center gap-3 text-sm">
                                      <Switch
                                        checked={field.state.value}
                                        onCheckedChange={(value) =>
                                          field.handleChange(value)
                                        }
                                      />
                                      Automatic failover for managed replicas
                                    </Label>
                                  )}
                                </form.Field>
                              </>
                            )
                          }
                        </form.Subscribe>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                        <form.Field
                          name="volumeName"
                          validators={{
                            onChange: z
                              .string()
                              .min(1, "Choose a Docker volume"),
                          }}
                        >
                          {(field) => (
                            <Field>
                              <FieldLabel>Docker volume</FieldLabel>
                              <Select
                                items={volumes.map((volume) => ({
                                  value: volume,
                                  label: volume,
                                }))}
                                value={field.state.value}
                                onValueChange={(value) =>
                                  field.handleChange(value || "")
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Discover or select a volume" />
                                </SelectTrigger>
                                <SelectContent>
                                  {volumes.map((volume) => (
                                    <SelectItem key={volume} value={volume}>
                                      {volume}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FieldError errors={field.state.meta.errors} />
                            </Field>
                          )}
                        </form.Field>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={isVolumesFetching}
                          onClick={() => void refetchVolumes()}
                        >
                          {isVolumesFetching ? <Spinner /> : "Discover volumes"}
                        </Button>
                      </div>
                      <form.Field name="stopService">
                        {(field) => (
                          <Label className="flex items-center gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm">
                            <Switch
                              checked={field.state.value}
                              onCheckedChange={(val) => field.handleChange(val)}
                            />{" "}
                            Stop the service during archive and restore for a
                            consistent volume snapshot.
                          </Label>
                        )}
                      </form.Field>
                    </>
                  )
                }
              </form.Subscribe>
            </FieldGroup>

            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <form.Subscribe
                selector={(state) => ({
                  canSubmit: state.canSubmit,
                })}
              >
                {({ canSubmit }) => (
                  <Button type="submit" disabled={!canSubmit || updating}>
                    {updating && <Spinner />}{" "}
                    {editingSchedule ? "Save changes" : "Create schedule"}
                  </Button>
                )}
              </form.Subscribe>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(scheduleToDelete)}
        onOpenChange={(open) => !open && setScheduleToDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete backup schedule?</DialogTitle>
            <DialogDescription>
              This permanently deletes every stored artifact recorded for{" "}
              {scheduleToDelete?.name}. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isDeletingSchedule}
              onClick={() => {
                if (scheduleToDelete) {
                  deleteSchedule(
                    { id: scheduleToDelete.id },
                    {
                      onSuccess: () => setScheduleToDelete(null),
                    },
                  );
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(runToRestore)}
        onOpenChange={(open) => !open && setRunToRestore(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore from backup?</DialogTitle>
            <DialogDescription>
              This will restore the resource database or volume to the state
              recorded on{" "}
              {runToRestore &&
                new Date(runToRestore.createdAt).toLocaleString()}
              .
              {runToRestore?.kind === "volume" && (
                <span className="mt-2 block font-semibold text-amber-500">
                  Warning: The service will be stopped during restoration if
                  configured on the schedule.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunToRestore(null)}>
              Cancel
            </Button>
            <Button
              disabled={isRestoring}
              onClick={() => {
                if (runToRestore) {
                  restoreRun(
                    { runId: runToRestore.id },
                    {
                      onSuccess: () => setRunToRestore(null),
                    },
                  );
                }
              }}
            >
              {isRestoring && <Spinner data-icon="inline-start" />}
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
