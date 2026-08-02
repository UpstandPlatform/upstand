"use client";

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
import { Switch } from "@upstand/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@upstand/ui/components/table";
import { Tabs, TabsList, TabsTrigger } from "@upstand/ui/components/tabs";
import { Textarea } from "@upstand/ui/components/textarea";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import {
  Clock,
  Edit3,
  ExternalLink,
  Play,
  Plus,
  Terminal,
  Trash2,
} from "@/components/huge-icons";
import { CodeBlock } from "@/components/shared/code-block";
import { getDocsUrl } from "@/lib/server-url";
import { trpc } from "@/utils/trpc";
import type { ResourceDetailState } from "../hooks/use-resource-detail";

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tehran",
  "Asia/Dubai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
];

const PREDEFINED_CRONS = [
  { label: "Every Minute (* * * * *)", value: "* * * * *" },
  { label: "Every 5 Minutes (*/5 * * * *)", value: "*/5 * * * *" },
  { label: "Every Hour (0 * * * *)", value: "0 * * * *" },
  { label: "Every Day at Midnight (0 0 * * *)", value: "0 0 * * *" },
  { label: "Every Monday at Midnight (0 0 * * 1)", value: "0 0 * * 1" },
  { label: "Every 1st of Month (0 0 1 * *)", value: "0 0 1 * *" },
];

const FRAMEWORK_SNIPPETS: Record<
  string,
  { funcPath: string; funcCode: string; secretCode: string }
> = {
  nextApp: {
    funcPath: "app/api/cron/route.js",
    funcCode: `import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ ok: true });
}`,
    secretCode: `const authHeader = req.headers.get('Authorization');
const cronSecret = process.env.CRON_SECRET;

if (!cronSecret || authHeader !== \`Bearer \${cronSecret}\`) {
  return new Response('Unauthorized', { status: 401 });
}`,
  },
  nextPages: {
    funcPath: "pages/api/cron.js",
    funcCode: `export default function handler(req, res) {
  res.status(200).end('Hello Cron!');
}`,
    secretCode: `const authHeader = req.headers.authorization;
const cronSecret = process.env.CRON_SECRET;

if (!cronSecret || authHeader !== \`Bearer \${cronSecret}\`) {
  return res.status(401).end('Unauthorized');
}`,
  },
  cli: {
    funcPath: "api/cron.js",
    funcCode: `export default function handler(req, res) {
  res.status(200).json({ ok: true });
}`,
    secretCode: `if (req.headers['authorization'] !== \`Bearer \${process.env.CRON_SECRET}\`) {
  return res.status(401).send('Unauthorized');
}`,
  },
  svelte: {
    funcPath: "src/routes/api/cron/+server.js",
    funcCode: `export function GET() {
  return new Response('Hello Cron!');
}`,
    secretCode: `export function GET({ request }) {
  const authHeader = request.headers.get('Authorization');
  if (authHeader !== \`Bearer \${process.env.CRON_SECRET}\`) {
    return new Response('Unauthorized', { status: 401 });
  }
  return new Response('Ok');
}`,
  },
  remix: {
    funcPath: "app/routes/api.cron.ts",
    funcCode: `import { json } from "@remix-run/node";

export const loader = async () => {
  return json({ ok: true });
};`,
    secretCode: `const authHeader = request.headers.get('Authorization');
if (authHeader !== \`Bearer \${process.env.CRON_SECRET}\`) {
  return new Response('Unauthorized', { status: 401 });
}`,
  },
  nuxt: {
    funcPath: "server/api/cron.js",
    funcCode: `export default defineEventHandler((event) => {
  return { ok: true };
});`,
    secretCode: `const authHeader = getRequestHeader(event, 'Authorization');
if (authHeader !== \`Bearer \${process.env.CRON_SECRET}\`) {
  setResponseStatus(event, 401);
  return 'Unauthorized';
}`,
  },
  solid: {
    funcPath: "src/routes/api/cron.ts",
    funcCode: `export function GET() {
  return new Response('Hello Cron!');
}`,
    secretCode: `const authHeader = request.headers.get('Authorization');
if (authHeader !== \`Bearer \${process.env.CRON_SECRET}\`) {
  return new Response('Unauthorized', { status: 401 });
}`,
  },
};

interface CronJobsTabProps {
  resource: NonNullable<ResourceDetailState["resource"]>;
}

type CronJobType = "command" | "cron" | "deployment" | "backup";
type ShellType = "bash" | "sh";
type Schedule = {
  id: string;
  name: string;
  description?: string | null;
  jobType: string;
  command?: string | null;
  cronExpression: string;
  timezone?: string | null;
  shellType?: string | null;
  serviceName?: string | null;
  backupScheduleId?: string | null;
  source?: string | null;
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
};
function parseCronJobType(value: string | null | undefined): CronJobType {
  return value === "cron" || value === "deployment" || value === "backup"
    ? value
    : "command";
}

function parseShellType(value: string | null | undefined): ShellType {
  return value === "sh" ? "sh" : "bash";
}

export function CronJobsTab({ resource }: CronJobsTabProps) {
  const queryClient = useQueryClient();
  const [_copiedKey, setCopiedKey] = useState<string | null>(null);
  const [selectedFramework, setSelectedFramework] = useState("nextApp");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [logsModalScheduleId, setLogsModalScheduleId] = useState<string | null>(
    null,
  );
  const [scheduleToDelete, setScheduleToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    jobType: "command" as "command" | "cron" | "deployment" | "backup",
    command: "",
    cronExpression: "0 10 * * *",
    timezone: "UTC",
    shellType: "bash" as "bash" | "sh",
    serviceName: "",
    backupScheduleId: "",
  });

  // Fetch Schedules & Backup Schedules
  const {
    data: schedules,
    isLoading: loadingSchedules,
    refetch: refetchSchedules,
  } = useQuery({
    ...trpc.schedule.list.queryOptions({ resourceId: resource.id }),
  });

  const backupSchedulesQuery = useQuery({
    ...trpc.backup.listSchedules.queryOptions({ resourceId: resource.id }),
    enabled: Boolean(resource?.id),
  });

  // Fetch Logs
  const { data: logsData, isLoading: loadingLogs } = useQuery({
    ...trpc.schedule.listLogs.queryOptions({
      scheduleId: logsModalScheduleId || "",
      resourceId: resource.id,
      limit: 50,
    }),
    enabled: Boolean(logsModalScheduleId),
  });

  // Toggle CronJobs feature mutation
  const toggleFeatureMutation = useMutation({
    ...trpc.resource.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Cron Jobs setting updated");
      queryClient.invalidateQueries({ queryKey: [["resource"]] });
    },
    onError: (err) =>
      toast.error(err.message || "Failed to update Cron Jobs setting"),
  });

  // Create/Update schedule mutation
  const createMutation = useMutation({
    ...trpc.schedule.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Schedule created successfully");
      setCreateModalOpen(false);
      resetForm();
      refetchSchedules();
    },
    onError: (err) => toast.error(err.message || "Failed to create schedule"),
  });

  const updateMutation = useMutation({
    ...trpc.schedule.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Schedule updated successfully");
      setEditingSchedule(null);
      resetForm();
      refetchSchedules();
    },
    onError: (err) => toast.error(err.message || "Failed to update schedule"),
  });

  // Run Now mutation
  const runNowMutation = useMutation({
    ...trpc.schedule.runNow.mutationOptions(),
    onSuccess: () => {
      toast.success("Schedule execution triggered");
      setTimeout(() => refetchSchedules(), 2000);
    },
    onError: (err) => toast.error(err.message || "Failed to trigger schedule"),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    ...trpc.schedule.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("Schedule deleted");
      refetchSchedules();
    },
    onError: (err) => toast.error(err.message || "Failed to delete schedule"),
  });

  const _copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      jobType: "command",
      command: "",
      cronExpression: "0 10 * * *",
      timezone: "UTC",
      shellType: "bash",
      serviceName: "",
      backupScheduleId: "",
    });
  };

  const openEdit = (sch: Schedule) => {
    setEditingSchedule(sch);
    setFormData({
      name: sch.name,
      description: sch.description || "",
      jobType: parseCronJobType(sch.jobType),
      command: sch.command || "",
      cronExpression: sch.cronExpression,
      timezone: sch.timezone || "UTC",
      shellType: parseShellType(sch.shellType),
      serviceName: sch.serviceName || "",
      backupScheduleId: sch.backupScheduleId || "",
    });
  };

  const isEnabled = resource.cronJobsEnabled !== false;

  const currentSnippet =
    FRAMEWORK_SNIPPETS[selectedFramework] || FRAMEWORK_SNIPPETS.nextApp;

  return (
    <div className="space-y-8">
      {/* ─── Feature Toggle Banner ─────────────────────────────────────────────── */}
      <Card className="border border-border/40 bg-card/30">
        <CardHeader className="flex flex-col gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 font-bold text-xl">
              <Clock className="size-5 text-primary" /> Cron Jobs
            </CardTitle>
            <CardDescription className="mt-1 max-w-2xl text-muted-foreground text-sm">
              Easily monitor and manage your cron jobs. Disabling this feature
              will prevent all cron jobs from being executed. New cron jobs will
              still be created, updated, and deleted on each production
              deployment, but they will not run until the feature is
              reactivated.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="font-semibold text-muted-foreground text-xs">
              {isEnabled ? "Enabled" : "Disabled"}
            </span>
            <Switch
              checked={isEnabled}
              disabled={toggleFeatureMutation.isPending}
              onCheckedChange={(checked) => {
                toggleFeatureMutation.mutate({
                  id: resource.id,
                  cronJobsEnabled: checked,
                });
              }}
            />
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-between border-border/20 border-t pt-3 text-muted-foreground text-xs">
          <a
            href={getDocsUrl("/features/cron-jobs")}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 transition-colors hover:text-primary"
            suppressHydrationWarning
          >
            Learn more about Cron Jobs <ExternalLink className="size-3" />
          </a>
        </CardContent>
      </Card>

      {/* ─── Configured Schedules Table ────────────────────────────────────────── */}
      <Card className="border border-border/40 bg-card/20">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="font-semibold text-lg">
              Configured Schedules
            </CardTitle>
            <CardDescription className="text-muted-foreground text-xs">
              Schedules synced from upstand.json or manually created for this
              resource.
            </CardDescription>
          </div>
          <Button
            onClick={() => {
              resetForm();
              setCreateModalOpen(true);
            }}
            className="h-9 gap-2 text-xs"
          >
            <Plus className="size-4" /> New Schedule
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {loadingSchedules ? (
            <div className="flex justify-center py-8 text-center text-muted-foreground">
              <Spinner className="size-6" />
            </div>
          ) : schedules && schedules.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border/30">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead className="text-xs">Name / Path</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Schedule (Cron)</TableHead>
                    <TableHead className="text-xs">Timezone</TableHead>
                    <TableHead className="text-xs">Source</TableHead>
                    <TableHead className="text-xs">Last Run</TableHead>
                    <TableHead className="text-right text-xs">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.map((sch) => (
                    <TableRow key={sch.id} className="hover:bg-muted/20">
                      <TableCell className="font-medium text-xs">
                        <div>
                          <span>{sch.name}</span>
                          <p className="max-w-xs truncate font-mono text-[11px] text-muted-foreground">
                            {sch.command
                              ? sch.command
                              : sch.jobType === "deployment"
                                ? "Trigger build & deploy"
                                : sch.jobType === "backup"
                                  ? "Trigger backup schedule"
                                  : "—"}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge
                          variant="outline"
                          className="text-[10px] capitalize"
                        >
                          {sch.jobType === "cron"
                            ? "HTTP Cron"
                            : sch.jobType === "command"
                              ? "Command"
                              : sch.jobType === "deployment"
                                ? "Deployment"
                                : sch.jobType === "backup"
                                  ? "Backup"
                                  : sch.jobType}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-primary text-xs">
                        {sch.cronExpression}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {sch.timezone || "UTC"}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge
                          variant={
                            sch.source === "upstand.json"
                              ? "secondary"
                              : "outline"
                          }
                          className="text-[10px]"
                        >
                          {sch.source || "manual"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {sch.lastRunAt ? (
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`size-2 rounded-full ${
                                sch.lastRunStatus === "success"
                                  ? "bg-success"
                                  : "bg-destructive"
                              }`}
                            />
                            <span className="text-[11px] text-muted-foreground">
                              {new Date(sch.lastRunAt).toLocaleTimeString()}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            Never
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Run Now"
                            disabled={runNowMutation.isPending}
                            onClick={() =>
                              runNowMutation.mutate({ id: sch.id })
                            }
                            className="h-8 w-8 p-0"
                          >
                            <Play className="size-3.5 text-success" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="View Logs"
                            onClick={() => setLogsModalScheduleId(sch.id)}
                            className="h-8 w-8 p-0"
                          >
                            <Terminal className="size-3.5 text-muted-foreground" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Edit"
                            onClick={() => openEdit(sch)}
                            className="h-8 w-8 p-0"
                          >
                            <Edit3 className="size-3.5 text-muted-foreground" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Delete"
                            disabled={deleteMutation.isPending}
                            onClick={() => {
                              setScheduleToDelete({
                                id: sch.id,
                                name: sch.name,
                              });
                            }}
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-lg border border-border/40 border-dashed py-8 text-center text-muted-foreground text-xs">
              No schedules found. Add a cron job to{" "}
              <code className="font-bold font-mono text-primary">
                upstand.json
              </code>{" "}
              or click "New Schedule" above.
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Get Started with Cron Jobs Guide ────────────────────────────────────── */}
      <Card className="border border-border/40 bg-card/20">
        <CardHeader>
          <CardTitle className="font-bold text-lg">
            Get Started with Cron Jobs on Upstand
          </CardTitle>
          <CardDescription className="text-muted-foreground text-xs">
            Follow the steps below to configure automatic HTTP cron jobs in your
            project codebase.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Framework Tabs */}
          <Tabs value={selectedFramework} onValueChange={setSelectedFramework}>
            <TabsList className="w-full justify-start overflow-x-auto border border-border/30 bg-card/50 p-1">
              <TabsTrigger value="nextApp" className="text-xs">
                Next.js (App Router)
              </TabsTrigger>
              <TabsTrigger value="nextPages" className="text-xs">
                Next.js (Pages Router)
              </TabsTrigger>
              <TabsTrigger value="cli" className="text-xs">
                Upstand CLI
              </TabsTrigger>
              <TabsTrigger value="svelte" className="text-xs">
                SvelteKit
              </TabsTrigger>
              <TabsTrigger value="remix" className="text-xs">
                Remix
              </TabsTrigger>
              <TabsTrigger value="nuxt" className="text-xs">
                Nuxt
              </TabsTrigger>
              <TabsTrigger value="solid" className="text-xs">
                SolidStart
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Step 1 */}
          <div className="space-y-3 rounded-xl border border-border/30 bg-background/50 p-4">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary/20 font-bold text-primary text-xs">
                1
              </span>
              <h4 className="font-semibold text-sm">
                Add a Serverless Function to your project
              </h4>
            </div>
            <CodeBlock
              code={currentSnippet.funcCode}
              language="javascript"
              filename={currentSnippet.funcPath}
            />
          </div>

          {/* Step 2 */}
          <div className="space-y-3 rounded-xl border border-border/30 bg-background/50 p-4">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary/20 font-bold text-primary text-xs">
                2
              </span>
              <h4 className="font-semibold text-sm">
                Add a cron job to your upstand.json
              </h4>
            </div>
            <CodeBlock
              code={`{\n  "crons": [\n    {\n      "path": "/api/cron",\n      "schedule": "0 10 * * *"\n    }\n  ]\n}`}
              language="json"
              filename="upstand.json"
            />
          </div>

          {/* Step 3 */}
          <div className="space-y-3 rounded-xl border border-border/30 bg-background/50 p-4">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary/20 font-bold text-primary text-xs">
                3
              </span>
              <h4 className="font-semibold text-sm">
                Add a secret to your project
              </h4>
            </div>
            <p className="text-muted-foreground text-xs">
              Prevent unauthorized access by adding the{" "}
              <code className="font-mono text-primary">CRON_SECRET</code>{" "}
              environment variable to your project and checking incoming
              requests. Upstand will send it as part of the{" "}
              <code className="font-mono text-primary">Authorization</code>{" "}
              header.
            </p>
            <CodeBlock
              code={currentSnippet.secretCode}
              language="javascript"
              filename="Verification logic"
            />
          </div>
        </CardContent>
      </Card>

      {/* ─── Create / Edit Schedule Modal ────────────────────────────────────── */}
      <Dialog
        open={createModalOpen || Boolean(editingSchedule)}
        onOpenChange={(open) => {
          if (!open) {
            setCreateModalOpen(false);
            setEditingSchedule(null);
          }
        }}
      >
        <DialogContent className="max-w-lg rounded-2xl border border-border bg-card shadow-2xl">
          <DialogHeader>
            <DialogTitle className="font-bold text-lg">
              {editingSchedule ? "Edit Schedule" : "New Schedule"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              Configure a recurring HTTP cron job or Dokploy-style container
              script schedule.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const payload = {
                name: formData.name,
                description: formData.description || undefined,
                jobType: formData.jobType,
                command:
                  formData.jobType === "command" || formData.jobType === "cron"
                    ? formData.command
                    : "",
                cronExpression: formData.cronExpression,
                timezone: formData.timezone,
                shellType: formData.shellType,
                serviceName: formData.serviceName || undefined,
                backupScheduleId:
                  formData.jobType === "backup"
                    ? formData.backupScheduleId || null
                    : null,
              };

              if (editingSchedule) {
                updateMutation.mutate({
                  id: editingSchedule.id,
                  ...payload,
                });
              } else {
                createMutation.mutate({
                  resourceId: resource.id,
                  ...payload,
                });
              }
            }}
            className="space-y-4 pt-2"
          >
            <div className="space-y-2">
              <Label htmlFor="sch-name" className="font-medium text-xs">
                Task Name
              </Label>
              <Input
                id="sch-name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="e.g. Daily Cleanup Task"
                required
                className="text-xs"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sch-desc" className="font-medium text-xs">
                Description (Optional)
              </Label>
              <Input
                id="sch-desc"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="e.g. Cleans temp directories every midnight"
                className="text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="font-medium text-xs">Type</Label>
                <Select
                  items={[
                    { value: "command", label: "Command / Script" },
                    { value: "cron", label: "HTTP Endpoint Cron" },
                    { value: "deployment", label: "Deployment (Rebuild)" },
                    { value: "backup", label: "Backup Schedule" },
                  ]}
                  value={formData.jobType}
                  onValueChange={(val) => {
                    if (
                      val === "command" ||
                      val === "cron" ||
                      val === "deployment" ||
                      val === "backup"
                    ) {
                      setFormData({ ...formData, jobType: val });
                    }
                  }}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="command" className="text-xs">
                      Command / Script
                    </SelectItem>
                    <SelectItem value="cron" className="text-xs">
                      HTTP Endpoint Cron
                    </SelectItem>
                    <SelectItem value="deployment" className="text-xs">
                      Deployment (Rebuild)
                    </SelectItem>
                    <SelectItem value="backup" className="text-xs">
                      Backup Schedule
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="font-medium text-xs">Timezone</Label>
                <Select
                  items={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
                  value={formData.timezone}
                  onValueChange={(val) =>
                    setFormData({ ...formData, timezone: val ?? "UTC" })
                  }
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz} className="text-xs">
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="font-medium text-xs">Predefined Schedule</Label>
              <Select
                items={PREDEFINED_CRONS}
                onValueChange={(val: string | null | undefined) => {
                  if (val) setFormData({ ...formData, cronExpression: val });
                }}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Choose shortcut or enter custom..." />
                </SelectTrigger>
                <SelectContent>
                  {PREDEFINED_CRONS.map((p) => (
                    <SelectItem
                      key={p.value}
                      value={p.value}
                      className="text-xs"
                    >
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sch-cron" className="font-medium text-xs">
                Cron Expression
              </Label>
              <Input
                id="sch-cron"
                value={formData.cronExpression}
                onChange={(e) =>
                  setFormData({ ...formData, cronExpression: e.target.value })
                }
                placeholder="e.g. 0 10 * * *"
                required
                className="font-mono text-xs"
              />
            </div>

            {formData.jobType === "cron" && (
              <div className="space-y-2">
                <Label htmlFor="sch-path" className="font-medium text-xs">
                  HTTP Path
                </Label>
                <Input
                  id="sch-path"
                  value={formData.command}
                  onChange={(e) =>
                    setFormData({ ...formData, command: e.target.value })
                  }
                  placeholder="e.g. /api/cron"
                  required
                  className="font-mono text-xs"
                />
              </div>
            )}

            {formData.jobType === "backup" && (
              <div className="space-y-2">
                <Label htmlFor="sch-backup" className="font-medium text-xs">
                  Backup Schedule
                </Label>
                <Select
                  items={(backupSchedulesQuery.data ?? []).map((backup) => ({
                    value: backup.id,
                    label: backup.name,
                  }))}
                  value={formData.backupScheduleId}
                  onValueChange={(val) =>
                    setFormData({ ...formData, backupScheduleId: val ?? "" })
                  }
                >
                  <SelectTrigger id="sch-backup" className="h-9 text-xs">
                    <SelectValue placeholder="Select target backup schedule..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(backupSchedulesQuery.data ?? []).map((backup) => (
                      <SelectItem
                        key={backup.id}
                        value={backup.id}
                        className="text-xs"
                      >
                        {backup.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {formData.jobType === "deployment" && (
              <div className="rounded-lg border border-border/40 bg-muted/20 p-3 text-muted-foreground text-xs">
                This schedule will automatically queue a full build &
                redeployment operation of this resource on the configured cron
                schedule.
              </div>
            )}

            {formData.jobType === "command" && (
              <>
                {resource.type === "compose" && (
                  <div className="space-y-2">
                    <Label
                      htmlFor="sch-service"
                      className="font-medium text-xs"
                    >
                      Compose Service Name
                    </Label>
                    <Input
                      id="sch-service"
                      value={formData.serviceName}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          serviceName: e.target.value,
                        })
                      }
                      placeholder="e.g. web or api"
                      className="font-mono text-xs"
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="font-medium text-xs">Shell</Label>
                    <Select
                      items={[
                        { value: "bash", label: "bash" },
                        { value: "sh", label: "sh" },
                      ]}
                      value={formData.shellType}
                      onValueChange={(val) => {
                        if (val === "bash" || val === "sh") {
                          setFormData({ ...formData, shellType: val });
                        }
                      }}
                    >
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue placeholder="Shell" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bash" className="text-xs">
                          bash
                        </SelectItem>
                        <SelectItem value="sh" className="text-xs">
                          sh
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sch-cmd" className="font-medium text-xs">
                    Command / Script
                  </Label>
                  <Textarea
                    id="sch-cmd"
                    value={formData.command}
                    onChange={(e) =>
                      setFormData({ ...formData, command: e.target.value })
                    }
                    placeholder="e.g. npm run backup"
                    required
                    rows={3}
                    className="font-mono text-xs"
                  />
                </div>
              </>
            )}

            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setCreateModalOpen(false);
                  setEditingSchedule(null);
                }}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="gap-2 text-xs"
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Spinner className="size-4" />
                )}
                {editingSchedule ? "Save Changes" : "Create Schedule"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── Schedule Logs Modal ──────────────────────────────────────────────── */}
      <Dialog
        open={Boolean(logsModalScheduleId)}
        onOpenChange={(open) => {
          if (!open) setLogsModalScheduleId(null);
        }}
      >
        <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col rounded-2xl border border-border bg-card shadow-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-bold text-lg">
              <Terminal className="size-5 text-primary" /> Execution History &
              Logs
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-xs">
              Recent execution attempts and output logs for this schedule.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-3 overflow-y-auto pt-2">
            {loadingLogs ? (
              <div className="flex justify-center py-12 text-center text-muted-foreground">
                <Spinner className="size-6" />
              </div>
            ) : logsData && logsData.length > 0 ? (
              <div className="space-y-3">
                {logsData.map((log) => (
                  <div
                    key={log.id}
                    className="space-y-2 rounded-lg border border-border/30 bg-background/50 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            log.status === "success"
                              ? "secondary"
                              : "destructive"
                          }
                          className="text-[10px]"
                        >
                          {log.status}
                        </Badge>
                        {log.statusCode !== null && (
                          <span className="font-mono text-muted-foreground">
                            Code: {log.statusCode}
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          {log.durationMs}ms
                        </span>
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(log.executedAt).toLocaleString()}
                      </span>
                    </div>

                    {log.errorMessage && (
                      <div className="rounded border border-destructive/20 bg-destructive/5 p-2 font-mono text-[11px] text-destructive">
                        {log.errorMessage}
                      </div>
                    )}

                    {log.responseBody && (
                      <div className="max-h-40 overflow-x-auto rounded border border-border/30 bg-zinc-950 p-2 font-mono text-[11px] text-zinc-300">
                        <pre>{log.responseBody}</pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-border/40 border-dashed py-12 text-center text-muted-foreground text-xs">
                No execution logs recorded yet. Click "Run Now" to trigger a
                test execution.
              </div>
            )}
          </div>

          <DialogFooter className="border-border/20 border-t pt-2">
            <Button
              variant="ghost"
              onClick={() => setLogsModalScheduleId(null)}
              className="text-xs"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={Boolean(scheduleToDelete)}
        onOpenChange={(open) => !open && setScheduleToDelete(null)}
        title="Delete Cron Job?"
        description={`Are you sure you want to delete schedule "${scheduleToDelete?.name}"?`}
        actionLabel="Delete Schedule"
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (scheduleToDelete) {
            deleteMutation.mutate(
              { id: scheduleToDelete.id },
              {
                onSuccess: () => setScheduleToDelete(null),
              },
            );
          }
        }}
      />
    </div>
  );
}
