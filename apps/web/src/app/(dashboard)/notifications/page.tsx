"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { getUpGalTargetDefinition } from "@upstand/api/ai/upgal-ui-targets";
import type {
  NotificationChannelView,
  NotificationEventType,
  NotificationProviderType,
} from "@upstand/domain";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
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
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@upstand/ui/components/field";
import { Input } from "@upstand/ui/components/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@upstand/ui/components/select";
import { Spinner } from "@upstand/ui/components/spinner";
import { Switch } from "@upstand/ui/components/switch";
import { Textarea } from "@upstand/ui/components/textarea";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import {
  DashboardPage,
  DashboardPageHeader,
} from "@/components/dashboard/dashboard-page";
import { PageEmpty } from "@/components/dashboard/page-empty";
import { CardGridSkeleton } from "@/components/dashboard/page-skeleton";
import type { HugeIcon } from "@/components/huge-icons";
import {
  Bell,
  CircleDot,
  Link2,
  Mail,
  MessageCircle,
  MessageSquare,
  Pencil,
  PlusIcon,
  Radio,
  Send,
  Trash2,
  Users,
} from "@/components/huge-icons";
import { UpGalTarget } from "@/components/upgal-target";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { trpc } from "@/utils/trpc";

const addNotificationTarget = getUpGalTargetDefinition(
  "add-notification-channel",
);

type NotificationChannelDto = Omit<
  NotificationChannelView,
  "createdAt" | "updatedAt"
> & {
  createdAt: string;
  updatedAt: string;
};

type ConfigurationField = {
  key: string;
  label: string;
  placeholder?: string;
  type?: "email" | "number" | "password" | "text" | "textarea";
  required?: boolean;
  sensitive?: boolean;
  description?: string;
  defaultValue?: string;
};

type ProviderDefinition = {
  label: string;
  icon: HugeIcon;
  fields: ConfigurationField[];
};

const PROVIDERS: Record<NotificationProviderType, ProviderDefinition> = {
  slack: {
    label: "Slack",
    icon: MessageCircle,
    fields: [
      {
        key: "webhookUrl",
        label: "Webhook URL",
        placeholder: "https://hooks.slack.com/services/...",
        required: true,
      },
      {
        key: "channel",
        label: "Channel override",
        placeholder: "#deployments",
      },
    ],
  },
  telegram: {
    label: "Telegram",
    icon: Send,
    fields: [
      {
        key: "botToken",
        label: "Bot token",
        type: "password",
        required: true,
        sensitive: true,
      },
      { key: "chatId", label: "Chat ID", required: true },
      {
        key: "messageThreadId",
        label: "Message thread ID",
        placeholder: "Optional forum topic",
      },
    ],
  },
  discord: {
    label: "Discord",
    icon: MessageSquare,
    fields: [
      {
        key: "webhookUrl",
        label: "Webhook URL",
        placeholder: "https://discord.com/api/webhooks/...",
        required: true,
      },
    ],
  },
  lark: {
    label: "Lark",
    icon: CircleDot,
    fields: [
      {
        key: "webhookUrl",
        label: "Webhook URL",
        placeholder: "https://open.larksuite.com/open-apis/bot/v2/hook/...",
        required: true,
      },
    ],
  },
  teams: {
    label: "Microsoft Teams",
    icon: Users,
    fields: [
      {
        key: "webhookUrl",
        label: "Workflow webhook URL",
        placeholder: "https://...webhook.office.com/...",
        required: true,
      },
    ],
  },
  email: {
    label: "SMTP Email",
    icon: Mail,
    fields: [
      {
        key: "smtpHost",
        label: "SMTP host",
        placeholder: "smtp.example.com",
        required: true,
      },
      {
        key: "smtpPort",
        label: "SMTP port",
        type: "number",
        defaultValue: "587",
        required: true,
      },
      { key: "username", label: "Username", required: true },
      {
        key: "password",
        label: "Password",
        type: "password",
        required: true,
        sensitive: true,
      },
      {
        key: "fromAddress",
        label: "From address",
        type: "email",
        placeholder: "alerts@example.com",
        required: true,
      },
      {
        key: "toAddresses",
        label: "Recipients",
        type: "text",
        placeholder: "oncall@example.com, team@example.com",
        required: true,
      },
      {
        key: "secure",
        label: "Use TLS immediately",
        description: "Usually enabled only for SMTP port 465.",
      },
    ],
  },
  resend: {
    label: "Resend",
    icon: Send,
    fields: [
      {
        key: "apiKey",
        label: "API key",
        type: "password",
        required: true,
        sensitive: true,
      },
      {
        key: "fromAddress",
        label: "From address",
        type: "email",
        placeholder: "alerts@example.com",
        required: true,
      },
      {
        key: "toAddresses",
        label: "Recipients",
        placeholder: "oncall@example.com, team@example.com",
        required: true,
      },
    ],
  },
  gotify: {
    label: "Gotify",
    icon: Bell,
    fields: [
      {
        key: "serverUrl",
        label: "Server URL",
        placeholder: "https://gotify.example.com",
        required: true,
      },
      {
        key: "appToken",
        label: "Application token",
        type: "password",
        required: true,
        sensitive: true,
      },
      {
        key: "priority",
        label: "Priority",
        type: "number",
        defaultValue: "5",
        required: true,
      },
    ],
  },
  ntfy: {
    label: "ntfy",
    icon: Radio,
    fields: [
      {
        key: "serverUrl",
        label: "Server URL",
        placeholder: "https://ntfy.sh",
        required: true,
      },
      {
        key: "topic",
        label: "Topic",
        placeholder: "upstand-alerts",
        required: true,
      },
      {
        key: "accessToken",
        label: "Access token",
        type: "password",
        sensitive: true,
      },
      {
        key: "priority",
        label: "Priority",
        type: "number",
        defaultValue: "3",
        required: true,
      },
    ],
  },
  mattermost: {
    label: "Mattermost",
    icon: CircleDot,
    fields: [
      { key: "webhookUrl", label: "Incoming webhook URL", required: true },
      { key: "channel", label: "Channel override", placeholder: "deployments" },
      { key: "username", label: "Display name", placeholder: "Upstand" },
    ],
  },
  pushover: {
    label: "Pushover",
    icon: Bell,
    fields: [
      {
        key: "userKey",
        label: "User key",
        type: "password",
        required: true,
        sensitive: true,
      },
      {
        key: "apiToken",
        label: "Application API token",
        type: "password",
        required: true,
        sensitive: true,
      },
      {
        key: "priority",
        label: "Priority (-2 to 2)",
        type: "number",
        defaultValue: "0",
        required: true,
      },
      {
        key: "retry",
        label: "Emergency retry seconds",
        type: "number",
        description: "Required when priority is 2.",
      },
      {
        key: "expire",
        label: "Emergency expire seconds",
        type: "number",
        description: "Required when priority is 2.",
      },
    ],
  },
  custom: {
    label: "Custom webhook",
    icon: Link2,
    fields: [
      {
        key: "endpoint",
        label: "Endpoint URL",
        placeholder: "https://example.com/hooks/upstand",
        required: true,
      },
      {
        key: "headers",
        label: "JSON headers",
        type: "textarea",
        placeholder: '{"Authorization":"Bearer …"}',
        description: "Optional HTTP headers included with every JSON webhook.",
      },
    ],
  },
};

const EVENT_OPTIONS: Array<{
  value: NotificationEventType;
  label: string;
  description: string;
}> = [
  {
    value: "deployment_succeeded",
    label: "App deploy",
    description: "When a resource deployment succeeds.",
  },
  {
    value: "deployment_failed",
    label: "App build error",
    description: "When a resource deployment fails.",
  },
  {
    value: "database_backup_completed",
    label: "Database backup",
    description: "When a database backup completes.",
  },
  {
    value: "volume_backup_completed",
    label: "Volume backup",
    description: "When a volume backup completes.",
  },
  {
    value: "web_server_backup_completed",
    label: "Web-server backup",
    description: "When a control-plane and proxy backup completes.",
  },
  {
    value: "docker_cleanup_completed",
    label: "Docker cleanup",
    description: "When scheduled Docker cleanup completes.",
  },
  {
    value: "docker_cleanup_failed",
    label: "Docker cleanup error",
    description: "When Docker cleanup fails.",
  },
  {
    value: "platform_restart",
    label: "Upstand restart",
    description: "When a platform update starts a restart.",
  },
  {
    value: "upstand_update_available",
    label: "Upstand update available",
    description: "When a newer Upstand release is detected.",
  },
  {
    value: "upstand_update_completed",
    label: "Upstand update completed",
    description: "When an Upstand update has finished restarting its services.",
  },
  {
    value: "cluster_initialized",
    label: "Cluster initialized",
    description: "When Docker Swarm is initialized.",
  },
  {
    value: "cluster_node_updated",
    label: "Cluster node updated",
    description: "When a node role or availability changes.",
  },
  {
    value: "cluster_node_removed",
    label: "Cluster node removed",
    description: "When a node is drained and removed.",
  },
  {
    value: "cluster_token_rotated",
    label: "Cluster token rotated",
    description: "When a worker or manager join token is rotated.",
  },
  {
    value: "server_threshold_alert",
    label: "Server threshold alert",
    description: "When host CPU or memory exceeds set alert thresholds.",
  },
];

function providerValues(
  provider: NotificationProviderType,
  summary?: Record<string, unknown> | null,
): Record<string, string> {
  const values = Object.fromEntries(
    PROVIDERS[provider].fields.map((field) => [
      field.key,
      field.defaultValue ?? "",
    ]),
  );
  for (const [key, value] of Object.entries(summary ?? {})) {
    values[key] = Array.isArray(value)
      ? value.join(", ")
      : key === "headers"
        ? JSON.stringify(value)
        : String(value);
  }
  return values;
}

function ProviderForm({
  provider,
  values,
  onChange,
  editing,
}: {
  provider: NotificationProviderType;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  editing: boolean;
}) {
  return (
    <FieldGroup>
      {PROVIDERS[provider].fields.map((field) => {
        if (field.key === "secure") {
          const checked = values.secure === "true";
          return (
            <Field key={field.key} orientation="horizontal">
              <FieldContent>
                <FieldTitle>{field.label}</FieldTitle>
                {field.description && (
                  <FieldDescription>{field.description}</FieldDescription>
                )}
              </FieldContent>
              <Switch
                checked={checked}
                onCheckedChange={(next) => onChange(field.key, String(next))}
              />
            </Field>
          );
        }

        const placeholder =
          field.sensitive && editing
            ? "Leave blank to keep the saved value"
            : field.placeholder;
        return (
          <Field key={field.key}>
            <FieldLabel htmlFor={`notification-${field.key}`}>
              {field.label}
            </FieldLabel>
            {field.type === "textarea" ? (
              <Textarea
                id={`notification-${field.key}`}
                value={values[field.key] ?? ""}
                onChange={(event) => onChange(field.key, event.target.value)}
                placeholder={placeholder}
              />
            ) : (
              <Input
                id={`notification-${field.key}`}
                type={field.type ?? "text"}
                value={values[field.key] ?? ""}
                onChange={(event) => onChange(field.key, event.target.value)}
                placeholder={placeholder}
                required={field.required && !(editing && field.sensitive)}
              />
            )}
            {field.description && (
              <FieldDescription>{field.description}</FieldDescription>
            )}
          </Field>
        );
      })}
    </FieldGroup>
  );
}

export default function NotificationsPage() {
  const organizationState = useRequiredActiveOrganization();
  const organizationId = organizationState.organizationId as string;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<NotificationChannelDto | null>(null);
  const [provider, setProvider] = useState<NotificationProviderType>("slack");
  const [name, setName] = useState("");
  const [events, setEvents] = useState<NotificationEventType[]>([]);
  const [removeTarget, setRemoveTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() =>
    providerValues("slack"),
  );

  const {
    data: channels = [],
    refetch,
    isPending: loadingChannels,
  } = useQuery({
    ...trpc.notification.list.queryOptions({ organizationId }),
    enabled: organizationState.status === "ready",
  });

  const createChannel = useMutation({
    ...trpc.notification.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Notification channel added");
      closeDialog();
      refetch();
    },
    onError: (error) =>
      toast.error(error.message || "Could not add notification channel"),
  });
  const updateChannel = useMutation({
    ...trpc.notification.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Notification channel updated");
      closeDialog();
      refetch();
    },
    onError: (error) =>
      toast.error(error.message || "Could not update notification channel"),
  });
  const removeChannel = useMutation({
    ...trpc.notification.remove.mutationOptions(),
    onSuccess: () => {
      toast.success("Notification channel removed");
      setRemoveTarget(null);
      refetch();
    },
    onError: (error) =>
      toast.error(error.message || "Could not remove notification channel"),
  });
  const testChannel = useMutation({
    ...trpc.notification.test.mutationOptions(),
    onSuccess: () => toast.success("Test notification delivered"),
    onError: (error) =>
      toast.error(error.message || "Test notification failed"),
  });

  const isPending = createChannel.isPending || updateChannel.isPending;

  useEffect(() => {
    if (!dialogOpen) return;
    if (editing) {
      setProvider(editing.provider);
      setName(editing.name);
      setEvents(editing.events);
      setValues(providerValues(editing.provider, editing.configurationSummary));
    }
  }, [dialogOpen, editing]);

  const providerOptions = useMemo(
    () =>
      Object.entries(PROVIDERS) as Array<
        [NotificationProviderType, ProviderDefinition]
      >,
    [],
  );

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    setProvider("slack");
    setName("");
    setEvents([]);
    setValues(providerValues("slack"));
  };

  const openCreate = () => {
    setEditing(null);
    setProvider("slack");
    setName("");
    setEvents([]);
    setValues(providerValues("slack"));
    setDialogOpen(true);
  };

  const changeProvider = (next: NotificationProviderType) => {
    setProvider(next);
    setValues(providerValues(next));
  };

  const toggleEvent = (event: NotificationEventType, checked: boolean) => {
    setEvents((current) =>
      checked
        ? [...new Set([...current, event])]
        : current.filter((item) => item !== event),
    );
  };

  const buildConfiguration = () => {
    const configuration: Record<string, unknown> = { type: provider };
    for (const field of PROVIDERS[provider].fields) {
      const value = values[field.key]?.trim() ?? "";
      if (!value && (field.sensitive || !field.required)) continue;
      if (field.key === "toAddresses") {
        configuration[field.key] = value.split(/[\s,]+/).filter(Boolean);
      } else if (
        ["smtpPort", "priority", "retry", "expire"].includes(field.key)
      ) {
        configuration[field.key] = Number(value);
      } else if (field.key === "secure") {
        configuration[field.key] = values.secure === "true";
      } else if (field.key === "headers") {
        configuration[field.key] = value ? JSON.parse(value) : {};
      } else {
        configuration[field.key] = value;
      }
    }
    return configuration;
  };

  const submit = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (events.length === 0) {
      toast.error("Select at least one notification action");
      return;
    }
    let configuration: Record<string, unknown>;
    try {
      configuration = buildConfiguration();
    } catch {
      toast.error("Custom headers must be a valid JSON object");
      return;
    }

    if (editing) {
      updateChannel.mutate({ id: editing.id, name, events, configuration });
      return;
    }
    createChannel.mutate({
      organizationId,
      name,
      events,
      configuration: configuration as never,
    });
  };

  return (
    <DashboardPage>
      <DashboardPageHeader
        title="Notifications"
        icon={<Bell className="size-6 text-primary" />}
        description="Route operational alerts to multiple channels. Credentials stay encrypted and delivery failures never block deployments."
        actions={
          <UpGalTarget definition={addNotificationTarget}>
            <Button
              onClick={openCreate}
              disabled={!organizationId}
              className="gap-2 font-medium"
            >
              <PlusIcon data-icon="inline-start" />
              Add Channel
            </Button>
          </UpGalTarget>
        }
      />

      {loadingChannels ? (
        <CardGridSkeleton count={3} />
      ) : channels.length === 0 ? (
        <PageEmpty
          icon={Bell}
          title="No notification channels"
          description="Add Slack, email, webhooks, or any supported provider to receive deployment and operational alerts."
          action={
            <Button
              onClick={openCreate}
              disabled={!organizationId}
              className="gap-2"
            >
              <PlusIcon data-icon="inline-start" />
              Add Channel
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {channels.map((channel) => (
            <Card key={channel.id} className="gap-3 py-4">
              <CardHeader className="px-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-primary">
                      {(() => {
                        const ProviderIcon = PROVIDERS[channel.provider].icon;
                        return (
                          <ProviderIcon aria-hidden="true" className="size-4" />
                        );
                      })()}
                    </span>
                    <div className="min-w-0">
                      <CardTitle className="truncate text-sm">
                        {channel.name}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {PROVIDERS[channel.provider].label} ·{" "}
                        {channel.events.length} action
                        {channel.events.length === 1 ? "" : "s"}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      title="Test channel"
                      aria-label="Test channel"
                      onClick={() => testChannel.mutate({ id: channel.id })}
                      disabled={testChannel.isPending}
                    >
                      {testChannel.isPending ? (
                        <Spinner />
                      ) : (
                        <Send className="size-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      title="Edit channel"
                      aria-label="Edit channel"
                      onClick={() => {
                        setEditing(channel);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      title="Remove channel"
                      aria-label="Remove channel"
                      onClick={() =>
                        setRemoveTarget({ id: channel.id, name: channel.name })
                      }
                      disabled={removeChannel.isPending}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}
      >
        <DialogContent className="flex h-[min(92svh,900px)] w-[calc(100vw-1rem)] max-w-[min(96vw,960px)] flex-col gap-0 overflow-hidden p-0 sm:min-w-[min(42rem,calc(100vw-2rem))]">
          <DialogHeader className="shrink-0 border-border/60 border-b px-6 py-5">
            <DialogTitle>
              {editing
                ? "Edit Notification Channel"
                : "Add Notification Channel"}
            </DialogTitle>
            <DialogDescription>
              Select a provider, enter its connection details, then choose the
              operational events it should receive.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={submit}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <div className="min-h-0 flex-1 space-y-7 overflow-y-auto overscroll-contain px-6 pt-5 pb-6">
              <FieldGroup className="flex flex-row">
                <Field className="flex-1">
                  <FieldLabel htmlFor="notification-provider">
                    Provider
                  </FieldLabel>
                  <Select
                    value={provider}
                    onValueChange={(next) =>
                      changeProvider(next as NotificationProviderType)
                    }
                  >
                    <SelectTrigger
                      id="notification-provider"
                      className="w-full"
                    >
                      {(() => {
                        const ProviderIcon = PROVIDERS[provider].icon;
                        return (
                          <span className="flex items-center gap-2">
                            <ProviderIcon
                              aria-hidden="true"
                              className="size-4"
                            />
                            <SelectValue />
                          </span>
                        );
                      })()}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {providerOptions.map(([value, item]) => (
                          <SelectItem key={value} value={value}>
                            <item.icon aria-hidden="true" className="size-4" />
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field className="flex-1">
                  <FieldLabel htmlFor="notification-name">Name</FieldLabel>
                  <Input
                    id="notification-name"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Production alerts"
                  />
                </Field>
              </FieldGroup>

              <ProviderForm
                provider={provider}
                values={values}
                editing={Boolean(editing)}
                onChange={(key, value) =>
                  setValues((current) => ({ ...current, [key]: value }))
                }
              />

              <FieldSet>
                <FieldLegend>Select the actions</FieldLegend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {EVENT_OPTIONS.map((option) => (
                    <Field
                      key={option.value}
                      orientation="horizontal"
                      className="rounded-xl border p-4"
                    >
                      <FieldContent>
                        <FieldTitle>{option.label}</FieldTitle>
                        <FieldDescription>
                          {option.description}
                        </FieldDescription>
                      </FieldContent>
                      <Switch
                        checked={events.includes(option.value)}
                        onCheckedChange={(checked) =>
                          toggleEvent(option.value, checked)
                        }
                      />
                    </Field>
                  ))}
                </div>
              </FieldSet>
            </div>

            <DialogFooter className="shrink-0 border-border/60 border-t bg-popover/95 px-6 py-4 backdrop-blur supports-backdrop-filter:bg-popover/80">
              <Button type="button" variant="outline" onClick={closeDialog}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    Saving…
                  </>
                ) : editing ? (
                  "Save Changes"
                ) : (
                  "Create Channel"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={`Remove ${removeTarget?.name ?? "Notification Channel"}?`}
        description={`${removeTarget?.name ?? "This notification channel"} will stop receiving operational alerts. This action cannot be undone.`}
        actionLabel="Remove Channel"
        pending={removeChannel.isPending}
        onConfirm={() => {
          if (removeTarget) removeChannel.mutate({ id: removeTarget.id });
        }}
      />
    </DashboardPage>
  );
}
