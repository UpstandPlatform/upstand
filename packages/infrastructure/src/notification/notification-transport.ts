import {
  type NotificationConfiguration,
  OperationalError,
} from "@upstand/domain";
import { env } from "@upstand/env/server";
import { assertConfiguredHttpUrl } from "@upstand/platform/network/outbound";
import { readResponseTextLimited } from "@upstand/platform/network/response-body";
import type {
  NotificationAction,
  NotificationMessage,
  NotificationTransport,
} from "@upstand/usecases/notification/notification-transport.port";
import nodemailer from "nodemailer";

const NOTIFICATION_REQUEST_TIMEOUT_MS = 15_000;
const MAX_PROVIDER_ERROR_BODY_LENGTH = 500;
type AddressResolver = (
  hostname: string,
) => Promise<Array<{ address: string }>>;

function trimTrailingSlash(value: string): string {
  let str = value.trim();
  while (str.endsWith("/")) {
    str = str.slice(0, -1);
  }
  return str;
}

async function ensureSuccess(
  response: Response,
  provider: string,
): Promise<void> {
  if (response.ok) return;
  const body = await readResponsePrefix(
    response,
    MAX_PROVIDER_ERROR_BODY_LENGTH,
  );
  throw new OperationalError(
    `${provider} rejected the notification (${response.status} ${response.statusText})${body ? `: ${body}` : ""}`,
    "NOTIFICATION",
  );
}

async function readResponsePrefix(
  response: Response,
  maxLength: number,
): Promise<string> {
  if (!response.body) {
    return (
      await readResponseTextLimited(response, Math.max(maxLength * 4, 4096))
    ).slice(0, maxLength);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  try {
    while (totalLength <= maxLength) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      totalLength += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const bytes = new Uint8Array(Math.min(totalLength, maxLength));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= bytes.length) break;
    const length = Math.min(chunk.byteLength, bytes.length - offset);
    bytes.set(chunk.subarray(0, length), offset);
    offset += length;
  }

  return new TextDecoder().decode(bytes);
}

async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    NOTIFICATION_REQUEST_TIMEOUT_MS,
  );
  try {
    return await fetch(input, {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OperationalError("Notification request timed out.", "TIMEOUT", {
        cause: error,
      });
    }
    throw new OperationalError("Notification request failed.", "NETWORK", {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function getOutboundAllowlistedHosts(): string[] {
  return (env.UPSTAND_OUTBOUND_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return entities[character] || character;
  });
}

function getEventEmoji(event?: string): string {
  if (!event) return "🔔";
  switch (event) {
    case "deployment_succeeded":
      return "🚀";
    case "deployment_failed":
      return "❌";
    case "database_backup_completed":
      return "💾";
    case "volume_backup_completed":
      return "📁";
    case "web_server_backup_completed":
      return "🌐";
    case "platform_restart":
      return "⚡";
    case "docker_cleanup_completed":
      return "🧹";
    case "docker_cleanup_failed":
      return "🧹";
    case "cluster_initialized":
      return "🐝";
    case "cluster_node_updated":
      return "🔄";
    case "cluster_node_removed":
      return "🗑️";
    case "cluster_token_rotated":
      return "🔑";
    case "server_threshold_alert":
      return "🚨";
    default:
      return "🔔";
  }
}

function getEventColor(
  event?: string,
  isFailed?: boolean,
): { hex: string; decimal: number } {
  if (
    isFailed ||
    event === "deployment_failed" ||
    event === "docker_cleanup_failed" ||
    event === "server_threshold_alert" ||
    event === "cluster_node_removed"
  ) {
    return { hex: "#EF4444", decimal: 0xef4444 };
  }
  if (
    event === "deployment_succeeded" ||
    event?.includes("backup_completed") ||
    event === "docker_cleanup_completed"
  ) {
    return { hex: "#22C55E", decimal: 0x22c55e };
  }
  if (event === "platform_restart" || event === "cluster_token_rotated") {
    return { hex: "#F59E0B", decimal: 0xf59e0b };
  }
  return { hex: "#3B82F6", decimal: 0x3b82f6 };
}

function resolveNotificationActions(
  message: NotificationMessage,
): NotificationAction[] {
  const actions: NotificationAction[] = [];
  if (message.actions && Array.isArray(message.actions)) {
    for (const action of message.actions) {
      if (action.label && action.url) {
        actions.push({ label: action.label, url: action.url });
      }
    }
  }

  const meta = message.metadata ?? {};
  const baseUrl =
    typeof meta.dashboardUrl === "string"
      ? meta.dashboardUrl
      : typeof meta.url === "string"
        ? meta.url
        : env.UPSTAND_BASE_URL || env.APP_URL || "";

  if (
    typeof meta.actionUrl === "string" &&
    !actions.some((a) => a.url === meta.actionUrl)
  ) {
    actions.push({ label: "🔗 Open Link", url: meta.actionUrl });
  }

  if (
    meta.resourceId &&
    baseUrl &&
    !actions.some((a) => a.url.includes(`/resources/${meta.resourceId}`))
  ) {
    const cleanBase = trimTrailingSlash(baseUrl);
    actions.push({
      label: "📦 View Resource",
      url: `${cleanBase}/resources/${meta.resourceId}`,
    });
  }

  if (
    meta.deploymentId &&
    baseUrl &&
    !actions.some((a) => a.url.includes("/deployments/"))
  ) {
    const cleanBase = trimTrailingSlash(baseUrl);
    actions.push({
      label: "🚀 View Deployment",
      url: `${cleanBase}/deployments/${meta.deploymentId}`,
    });
  }

  if (
    meta.backupRunId &&
    baseUrl &&
    !actions.some((a) => a.url.includes("/backups"))
  ) {
    const cleanBase = trimTrailingSlash(baseUrl);
    actions.push({
      label: "💾 View Backups",
      url: `${cleanBase}/backups`,
    });
  }

  return actions;
}

function formatNotificationText(message: NotificationMessage): string {
  const meta = message.metadata;
  const event = meta?.event as string | undefined;
  const emoji = getEventEmoji(event);
  const lines: string[] = [message.message];

  if (!meta || typeof meta !== "object") return `${emoji} ${message.message}`;

  const metaFields: string[] = [];
  if (meta.resourceName) {
    metaFields.push(
      `📦 Resource: ${meta.resourceName}${meta.resourceType ? ` (${meta.resourceType})` : ""}`,
    );
  }
  if (meta.projectName || meta.environmentName) {
    const projEnv = [meta.projectName, meta.environmentName]
      .filter(Boolean)
      .join(" / ");
    metaFields.push(`📁 Scope: ${projEnv}`);
  }
  if (meta.serverName || meta.serverId) {
    metaFields.push(
      `🖥️ Server: ${meta.serverName || meta.serverId}${meta.alertType ? ` (${meta.alertType})` : ""}`,
    );
  }
  if (meta.value !== undefined && meta.threshold !== undefined) {
    metaFields.push(
      `📊 Metric: ${meta.value}% (Threshold: ${meta.threshold}%)`,
    );
  }
  if (meta.commitSha) {
    metaFields.push(`🔀 Commit: ${String(meta.commitSha).slice(0, 7)}`);
  }
  if (meta.fileKey) {
    metaFields.push(`📄 Backup File: ${meta.fileKey}`);
  }
  if (meta.version) {
    metaFields.push(`⚡ Version: ${meta.version}`);
  }
  if (meta.error) {
    metaFields.push(`🚨 Error: ${meta.error}`);
  }

  if (metaFields.length > 0) {
    lines.push(
      "",
      "📌 Context & Details:",
      ...metaFields.map((field) => `• ${field}`),
    );
  }

  const logs = meta.logs ?? meta.logTail ?? meta.logsSnippet;
  if (typeof logs === "string" && logs.trim()) {
    const trimmedLogs = logs.trim();
    const tailLines = trimmedLogs.split("\n").slice(-15).join("\n");
    lines.push("", "📋 Recent Logs:", tailLines);
  }

  return lines.join("\n");
}

export class NotificationTransportRegistry implements NotificationTransport {
  constructor(
    private readonly outboundAllowlistedHosts: readonly string[] = getOutboundAllowlistedHosts(),
    private readonly resolveHost?: AddressResolver,
  ) {}

  async send(
    configuration: NotificationConfiguration,
    message: NotificationMessage,
  ): Promise<void> {
    const configuredEndpoint =
      "webhookUrl" in configuration
        ? configuration.webhookUrl
        : "serverUrl" in configuration
          ? configuration.serverUrl
          : "endpoint" in configuration
            ? configuration.endpoint
            : undefined;
    if (configuredEndpoint) {
      await assertConfiguredHttpUrl(
        configuredEndpoint,
        this.outboundAllowlistedHosts,
        this.resolveHost,
      );
    }

    switch (configuration.type) {
      case "slack":
        return this.sendSlack(configuration, message);
      case "telegram":
        return this.sendTelegram(configuration, message);
      case "discord":
        return this.sendDiscord(configuration, message);
      case "lark":
        return this.sendLark(configuration, message);
      case "teams":
        return this.sendTeams(configuration, message);
      case "email":
        return this.sendEmail(configuration, message);
      case "resend":
        return this.sendResend(configuration, message);
      case "gotify":
        return this.sendGotify(configuration, message);
      case "ntfy":
        return this.sendNtfy(configuration, message);
      case "mattermost":
        return this.sendMattermost(configuration, message);
      case "pushover":
        return this.sendPushover(configuration, message);
      case "custom":
        return this.sendCustom(configuration, message);
    }
  }

  private async sendSlack(
    configuration: Extract<NotificationConfiguration, { type: "slack" }>,
    message: NotificationMessage,
  ): Promise<void> {
    const actions = resolveNotificationActions(message);
    const bodyText = formatNotificationText(message);
    const event = message.metadata?.event as string | undefined;
    const emoji = getEventEmoji(event);
    const formattedTitle = message.title.startsWith(emoji)
      ? message.title
      : `${emoji} ${message.title}`;

    const blocks: Record<string, unknown>[] = [
      {
        type: "header",
        text: { type: "plain_text", text: formattedTitle, emoji: true },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: bodyText },
      },
    ];

    if (actions.length > 0) {
      blocks.push({
        type: "actions",
        elements: actions.map((action) => ({
          type: "button",
          text: { type: "plain_text", text: action.label, emoji: true },
          url: action.url,
          ...(action.label.includes("View") || action.label.includes("Open")
            ? { style: "primary" }
            : {}),
        })),
      });
    }

    const response = await fetchWithTimeout(configuration.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `${formattedTitle}\n${bodyText}`,
        ...(configuration.channel ? { channel: configuration.channel } : {}),
        blocks,
      }),
    });
    await ensureSuccess(response, "Slack");
  }

  private async sendTelegram(
    configuration: Extract<NotificationConfiguration, { type: "telegram" }>,
    message: NotificationMessage,
  ): Promise<void> {
    const actions = resolveNotificationActions(message);
    const bodyText = formatNotificationText(message);
    const event = message.metadata?.event as string | undefined;
    const emoji = getEventEmoji(event);
    const formattedTitle = message.title.startsWith(emoji)
      ? message.title
      : `${emoji} ${message.title}`;

    const replyMarkup =
      actions.length > 0
        ? {
            inline_keyboard: [
              actions.map((action) => ({
                text: action.label,
                url: action.url,
              })),
            ],
          }
        : undefined;

    const response = await fetchWithTimeout(
      `https://api.telegram.org/bot${configuration.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: configuration.chatId,
          text: `<b>${escapeHtml(formattedTitle)}</b>\n\n${escapeHtml(bodyText)}`,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          ...(configuration.messageThreadId
            ? { message_thread_id: configuration.messageThreadId }
            : {}),
        }),
      },
    );
    await ensureSuccess(response, "Telegram");
  }

  private async sendDiscord(
    configuration: Extract<NotificationConfiguration, { type: "discord" }>,
    message: NotificationMessage,
  ): Promise<void> {
    const actions = resolveNotificationActions(message);
    const meta = message.metadata ?? {};
    const event = meta.event as string | undefined;
    const emoji = getEventEmoji(event);
    const formattedTitle = message.title.startsWith(emoji)
      ? message.title
      : `${emoji} ${message.title}`;
    const isFailed = meta.status === "failed" || !!meta.error;
    const color = getEventColor(event, isFailed).decimal;

    const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
    if (meta.resourceName) {
      fields.push({
        name: "📦 Resource",
        value: `${meta.resourceName}${meta.resourceType ? ` (${meta.resourceType})` : ""}`,
        inline: true,
      });
    }
    if (meta.projectName || meta.environmentName) {
      fields.push({
        name: "📁 Scope",
        value: [meta.projectName, meta.environmentName]
          .filter(Boolean)
          .join(" / "),
        inline: true,
      });
    }
    if (meta.serverName || meta.serverId) {
      fields.push({
        name: "🖥️ Server",
        value: `${meta.serverName || meta.serverId}`,
        inline: true,
      });
    }
    if (meta.value !== undefined && meta.threshold !== undefined) {
      fields.push({
        name: "📊 Usage",
        value: `${meta.value}% (Threshold: ${meta.threshold}%)`,
        inline: true,
      });
    }
    if (meta.commitSha) {
      fields.push({
        name: "🔀 Commit",
        value: String(meta.commitSha).slice(0, 7),
        inline: true,
      });
    }
    if (meta.error) {
      fields.push({
        name: "🚨 Error",
        value: String(meta.error).slice(0, 1000),
        inline: false,
      });
    }

    const primaryUrl = actions[0]?.url;

    const response = await fetchWithTimeout(configuration.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: formattedTitle,
            description: message.message,
            url: primaryUrl,
            color,
            ...(fields.length > 0 ? { fields } : {}),
            footer: { text: "Upstand Delivery Engine" },
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
    await ensureSuccess(response, "Discord");
  }

  private async sendLark(
    configuration: Extract<NotificationConfiguration, { type: "lark" }>,
    message: NotificationMessage,
  ): Promise<void> {
    const bodyText = formatNotificationText(message);
    const event = message.metadata?.event as string | undefined;
    const emoji = getEventEmoji(event);
    const formattedTitle = message.title.startsWith(emoji)
      ? message.title
      : `${emoji} ${message.title}`;

    const response = await fetchWithTimeout(configuration.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msg_type: "text",
        content: { text: `${formattedTitle}\n\n${bodyText}` },
      }),
    });
    await ensureSuccess(response, "Lark");
  }

  private async sendTeams(
    configuration: Extract<NotificationConfiguration, { type: "teams" }>,
    message: NotificationMessage,
  ): Promise<void> {
    const actions = resolveNotificationActions(message);
    const bodyText = formatNotificationText(message);
    const event = message.metadata?.event as string | undefined;
    const emoji = getEventEmoji(event);
    const formattedTitle = message.title.startsWith(emoji)
      ? message.title
      : `${emoji} ${message.title}`;

    const cardActions = actions.map((action) => ({
      type: "Action.OpenUrl",
      title: action.label,
      url: action.url,
    }));

    const response = await fetchWithTimeout(configuration.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "message",
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: {
              type: "AdaptiveCard",
              $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
              version: "1.4",
              body: [
                {
                  type: "TextBlock",
                  text: formattedTitle,
                  size: "Medium",
                  weight: "Bolder",
                  wrap: true,
                },
                { type: "TextBlock", text: bodyText, wrap: true },
              ],
              ...(cardActions.length > 0 ? { actions: cardActions } : {}),
            },
          },
        ],
      }),
    });
    await ensureSuccess(response, "Microsoft Teams");
  }

  private async sendEmail(
    configuration: Extract<NotificationConfiguration, { type: "email" }>,
    message: NotificationMessage,
  ): Promise<void> {
    const actions = resolveNotificationActions(message);
    const bodyText = formatNotificationText(message);
    const event = message.metadata?.event as string | undefined;
    const emoji = getEventEmoji(event);
    const formattedTitle = message.title.startsWith(emoji)
      ? message.title
      : `${emoji} ${message.title}`;
    const colorHex = getEventColor(event, Boolean(message.metadata?.error)).hex;

    const transport = nodemailer.createTransport({
      host: configuration.smtpHost,
      port: configuration.smtpPort,
      secure: configuration.secure,
      auth: { user: configuration.username, pass: configuration.password },
    });

    const actionButtonsHtml = actions
      .map(
        (a) =>
          `<a href="${escapeHtml(a.url)}" style="display:inline-block;padding:10px 18px;margin-right:8px;background-color:${colorHex};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:13px;">${escapeHtml(a.label)}</a>`,
      )
      .join(" ");

    try {
      await transport.sendMail({
        from: configuration.fromAddress,
        to: configuration.toAddresses.join(", "),
        subject: formattedTitle,
        text: `${bodyText}\n\n${actions.map((a) => `${a.label}: ${a.url}`).join("\n")}`,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;border-radius:8px;border:1px solid #e2e8f0;background-color:#ffffff;"><div style="border-left:4px solid ${colorHex};padding-left:12px;margin-bottom:16px;"><h2 style="margin:0;color:#0f172a;font-size:18px;">${escapeHtml(formattedTitle)}</h2></div><p style="color:#334155;line-height:1.6;font-size:14px;white-space:pre-wrap;">${escapeHtml(bodyText)}</p>${actionButtonsHtml ? `<div style="margin-top:20px;">${actionButtonsHtml}</div>` : ""}<hr style="margin-top:24px;border:none;border-top:1px solid #f1f5f9;" /><p style="color:#94a3b8;font-size:11px;margin:8px 0 0 0;">Upstand Automated System Notification</p></div>`,
      });
    } finally {
      transport.close();
    }
  }

  private async sendResend(
    configuration: Extract<NotificationConfiguration, { type: "resend" }>,
    message: NotificationMessage,
  ): Promise<void> {
    const actions = resolveNotificationActions(message);
    const bodyText = formatNotificationText(message);
    const event = message.metadata?.event as string | undefined;
    const emoji = getEventEmoji(event);
    const formattedTitle = message.title.startsWith(emoji)
      ? message.title
      : `${emoji} ${message.title}`;
    const colorHex = getEventColor(event, Boolean(message.metadata?.error)).hex;

    const actionButtonsHtml = actions
      .map(
        (a) =>
          `<a href="${escapeHtml(a.url)}" style="display:inline-block;padding:10px 18px;margin-right:8px;background-color:${colorHex};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:13px;">${escapeHtml(a.label)}</a>`,
      )
      .join(" ");

    const response = await fetchWithTimeout("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${configuration.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: configuration.fromAddress,
        to: configuration.toAddresses,
        subject: formattedTitle,
        text: `${bodyText}\n\n${actions.map((a) => `${a.label}: ${a.url}`).join("\n")}`,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;border-radius:8px;border:1px solid #e2e8f0;background-color:#ffffff;"><div style="border-left:4px solid ${colorHex};padding-left:12px;margin-bottom:16px;"><h2 style="margin:0;color:#0f172a;font-size:18px;">${escapeHtml(formattedTitle)}</h2></div><p style="color:#334155;line-height:1.6;font-size:14px;white-space:pre-wrap;">${escapeHtml(bodyText)}</p>${actionButtonsHtml ? `<div style="margin-top:20px;">${actionButtonsHtml}</div>` : ""}<hr style="margin-top:24px;border:none;border-top:1px solid #f1f5f9;" /><p style="color:#94a3b8;font-size:11px;margin:8px 0 0 0;">Upstand Automated System Notification</p></div>`,
      }),
    });
    await ensureSuccess(response, "Resend");
  }

  private async sendGotify(
    configuration: Extract<NotificationConfiguration, { type: "gotify" }>,
    message: NotificationMessage,
  ): Promise<void> {
    const actions = resolveNotificationActions(message);
    const bodyText = formatNotificationText(message);
    const event = message.metadata?.event as string | undefined;
    const emoji = getEventEmoji(event);
    const formattedTitle = message.title.startsWith(emoji)
      ? message.title
      : `${emoji} ${message.title}`;
    const clickUrl = actions[0]?.url;

    const response = await fetchWithTimeout(
      `${trimTrailingSlash(configuration.serverUrl)}/message`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Gotify-Key": configuration.appToken,
        },
        body: JSON.stringify({
          title: formattedTitle,
          message: bodyText,
          priority: configuration.priority,
          ...(clickUrl
            ? {
                extras: {
                  "client::notification": { click: { url: clickUrl } },
                },
              }
            : {}),
        }),
      },
    );
    await ensureSuccess(response, "Gotify");
  }

  private async sendNtfy(
    configuration: Extract<NotificationConfiguration, { type: "ntfy" }>,
    message: NotificationMessage,
  ): Promise<void> {
    const actions = resolveNotificationActions(message);
    const bodyText = formatNotificationText(message);
    const event = message.metadata?.event as string | undefined;
    const emoji = getEventEmoji(event);
    const formattedTitle = message.title.startsWith(emoji)
      ? message.title
      : `${emoji} ${message.title}`;
    const actionsHeader = actions
      .map((a) => `action=view, label=${a.label}, url=${a.url}`)
      .join("; ");

    const response = await fetchWithTimeout(
      `${trimTrailingSlash(configuration.serverUrl)}/${encodeURIComponent(configuration.topic)}`,
      {
        method: "POST",
        headers: {
          "X-Title": formattedTitle,
          "X-Priority": String(configuration.priority),
          ...(actionsHeader ? { "X-Actions": actionsHeader } : {}),
          ...(configuration.accessToken
            ? { Authorization: `Bearer ${configuration.accessToken}` }
            : {}),
        },
        body: bodyText,
      },
    );
    await ensureSuccess(response, "ntfy");
  }

  private async sendMattermost(
    configuration: Extract<NotificationConfiguration, { type: "mattermost" }>,
    message: NotificationMessage,
  ): Promise<void> {
    const actions = resolveNotificationActions(message);
    const bodyText = formatNotificationText(message);
    const event = message.metadata?.event as string | undefined;
    const emoji = getEventEmoji(event);
    const formattedTitle = message.title.startsWith(emoji)
      ? message.title
      : `${emoji} ${message.title}`;
    const actionLinksText = actions
      .map((a) => `[${a.label}](${a.url})`)
      .join(" • ");

    const response = await fetchWithTimeout(configuration.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `### ${formattedTitle}\n${bodyText}${actionLinksText ? `\n\n${actionLinksText}` : ""}`,
        ...(configuration.channel
          ? { channel: `#${configuration.channel.replace(/^#/, "")}` }
          : {}),
        ...(configuration.username ? { username: configuration.username } : {}),
      }),
    });
    await ensureSuccess(response, "Mattermost");
  }

  private async sendPushover(
    configuration: Extract<NotificationConfiguration, { type: "pushover" }>,
    message: NotificationMessage,
  ): Promise<void> {
    const actions = resolveNotificationActions(message);
    const bodyText = formatNotificationText(message);
    const event = message.metadata?.event as string | undefined;
    const emoji = getEventEmoji(event);
    const formattedTitle = message.title.startsWith(emoji)
      ? message.title
      : `${emoji} ${message.title}`;

    const form = new URLSearchParams({
      token: configuration.apiToken,
      user: configuration.userKey,
      title: formattedTitle,
      message: bodyText,
      priority: String(configuration.priority),
    });
    if (actions[0]) {
      form.set("url", actions[0].url);
      form.set("url_title", actions[0].label);
    }
    if (configuration.priority === 2) {
      form.set("retry", String(configuration.retry));
      form.set("expire", String(configuration.expire));
    }

    const response = await fetchWithTimeout(
      "https://api.pushover.net/1/messages.json",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      },
    );
    await ensureSuccess(response, "Pushover");
  }

  private async sendCustom(
    configuration: Extract<NotificationConfiguration, { type: "custom" }>,
    message: NotificationMessage,
  ): Promise<void> {
    const actions = resolveNotificationActions(message);
    const bodyText = formatNotificationText(message);
    const event = message.metadata?.event as string | undefined;
    const emoji = getEventEmoji(event);
    const formattedTitle = message.title.startsWith(emoji)
      ? message.title
      : `${emoji} ${message.title}`;

    const response = await fetchWithTimeout(configuration.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...configuration.headers,
      },
      body: JSON.stringify({
        event: event ?? "notification",
        emoji,
        title: formattedTitle,
        message: message.message,
        formattedText: bodyText,
        actions,
        timestamp: new Date().toISOString(),
        metadata: message.metadata ?? {},
      }),
    });
    await ensureSuccess(response, "Custom webhook");
  }
}
