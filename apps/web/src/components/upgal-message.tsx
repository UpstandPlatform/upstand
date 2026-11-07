"use client";

import type { UpGalUIAction, UpGalUIMessage } from "@upstand/api/ai/upgal";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@upstand/ui/components/alert";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@upstand/ui/components/attachment";
import { Bubble, BubbleContent } from "@upstand/ui/components/bubble";
import { Button } from "@upstand/ui/components/button";
import {
  Message,
  MessageAvatar,
  MessageContent,
} from "@upstand/ui/components/message";
import { getToolName, isTextUIPart, isToolUIPart } from "ai";
import { useEffect, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Trace } from "@/components/ai-elements/trace";
import {
  Bot,
  Check,
  Loader2,
  PaperclipIcon,
  ShieldAlert,
  ShieldCheck,
  X,
} from "@/components/huge-icons";
import { UpGalToolOutput } from "@/components/upgal-tool-output";
import { isUpGalUIAction } from "@/lib/upgal-ui-actions";

type MessagePart = UpGalUIMessage["parts"][number];

type MessagePartGroup =
  | { kind: "part"; part: MessagePart }
  | { kind: "tools"; parts: MessagePart[] }
  | { kind: "attachments"; parts: MessagePart[] };

const toolTitles: Record<string, string> = {
  create_environment: "environment creation",
  create_project: "project creation",
  control_resource: "resource state change",
  delete_project: "project deletion",
  delete_resource: "resource deletion",
  deploy_resource: "resource deployment",
  list_projects: "project lookup",
  list_environments: "environment lookup",
  list_resources: "resource lookup",
  get_resource_logs: "resource log lookup",
  get_resource_stats: "resource statistics",
  get_resource_config: "resource configuration lookup",
  list_servers: "server lookup",
  list_deployments: "deployment history lookup",
  create_tag: "tag creation",
  update_tag: "tag update",
  delete_tag: "tag deletion",
  assign_resource_tag: "resource tag assignment",
  detach_resource_tag: "resource tag removal",
  list_tags: "tag lookup",
  get_resource_tags: "resource tag lookup",
  search_web: "web search",
  guide_upstand: "Upstand guidance walkthrough",
};
const toolOperationNouns: Record<string, string> = {
  add: "addition",
  assign: "assignment",
  check: "check",
  control: "control",
  create: "creation",
  delete: "deletion",
  deploy: "deployment",
  detach: "removal",
  find: "lookup",
  get: "lookup",
  inspect: "inspection",
  list: "lookup",
  manage: "management",
  read: "lookup",
  remove: "removal",
  restart: "restart",
  search: "search",
  start: "start",
  stop: "stop",
  trigger: "trigger",
  update: "update",
};

function toolTitle(name: string) {
  const knownTitle = toolTitles[name];
  if (knownTitle) return knownTitle;

  const [operation, ...targetWords] = name
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  const target = targetWords.join(" ");
  const noun = toolOperationNouns[operation ?? ""];
  if (noun && target) return `${target} ${noun}`;

  return [operation, ...targetWords]
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function approvalDescription(name: string, input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return `${toolTitle(name)} will change your Upstand organization.`;
  }
  const values = Object.entries(input)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
    )
    .join(" · ");
  return values
    ? `${toolTitle(name)} will run with ${values}.`
    : `${toolTitle(name)} will change your Upstand organization.`;
}

function groupMessageParts(parts: MessagePart[]): MessagePartGroup[] {
  const groups: MessagePartGroup[] = [];

  for (const part of parts) {
    const kind = isToolUIPart(part)
      ? "tools"
      : part.type === "file"
        ? "attachments"
        : undefined;
    const previous = groups.at(-1);

    if (kind && previous?.kind === kind) {
      previous.parts.push(part);
      continue;
    }

    groups.push(kind ? { kind, parts: [part] } : { kind: "part", part });
  }

  return groups;
}

export type UpGalMessageProps = {
  message: UpGalUIMessage;
  approve: (id: string, approved: boolean) => void;
  approvalPendingId?: string;
  onReplay?: (action: UpGalUIAction) => void;
  onUiAction?: (actionId: string, action: UpGalUIAction) => void;
};

export function UpGalMessage({
  message,
  approve,
  approvalPendingId,
  onReplay,
  onUiAction,
}: UpGalMessageProps) {
  const groups = groupMessageParts(message.parts);
  const isUser = message.role === "user";

  return (
    <Message
      align={isUser ? "end" : "start"}
      className="fade-in slide-in-from-bottom-2 animate-in duration-200 motion-reduce:animate-none"
    >
      {!isUser ? (
        <MessageAvatar className="size-7 self-start rounded-full bg-primary/10 text-primary">
          <Bot className="size-4" />
        </MessageAvatar>
      ) : null}
      <MessageContent className="min-w-0 gap-2">
        {groups.map((group, index) => {
          if (group.kind === "tools") {
            return (
              <Trace key={`${message.id}-tools-${index}`}>
                {group.parts.map((part, partIndex) => (
                  <UpGalMessagePart
                    key={`${message.id}-tool-${partIndex}`}
                    part={part}
                    role={message.role}
                    approve={approve}
                    approvalPendingId={approvalPendingId}
                    onReplay={onReplay}
                    onUiAction={onUiAction}
                  />
                ))}
              </Trace>
            );
          }

          if (group.kind === "attachments") {
            return (
              <AttachmentGroup
                key={`${message.id}-attachments-${index}`}
                className="max-w-full gap-2"
              >
                {group.parts.map((part, partIndex) => (
                  <UpGalMessagePart
                    key={`${message.id}-attachment-${partIndex}`}
                    part={part}
                    role={message.role}
                    approve={approve}
                    approvalPendingId={approvalPendingId}
                    onReplay={onReplay}
                    onUiAction={onUiAction}
                  />
                ))}
              </AttachmentGroup>
            );
          }

          return (
            <UpGalMessagePart
              key={`${message.id}-part-${index}`}
              part={group.part}
              role={message.role}
              approve={approve}
              approvalPendingId={approvalPendingId}
              onReplay={onReplay}
              onUiAction={onUiAction}
            />
          );
        })}
      </MessageContent>
    </Message>
  );
}

function UpGalMessagePart({
  part,
  role,
  approve,
  approvalPendingId,
  onReplay,
  onUiAction,
}: {
  part: MessagePart;
  role: UpGalUIMessage["role"];
  approve: (id: string, approved: boolean) => void;
  approvalPendingId?: string;
  onReplay?: (action: UpGalUIAction) => void;
  onUiAction?: (actionId: string, action: UpGalUIAction) => void;
}) {
  const toolPart = isToolUIPart(part) ? part : undefined;
  const toolName = toolPart ? getToolName(toolPart) : undefined;
  const [open, setOpen] = useState<boolean>();
  const active =
    toolPart?.state === "input-streaming" ||
    toolPart?.state === "input-available" ||
    toolPart?.state === "approval-requested" ||
    toolPart?.state === "approval-responded";

  useEffect(() => {
    if (toolPart?.state !== "output-available") return;
    const candidate = toolPart as typeof toolPart & {
      output?: unknown;
      toolCallId?: string;
    };
    if (!candidate.toolCallId || !isUpGalUIAction(candidate.output)) return;
    onUiAction?.(candidate.toolCallId, candidate.output);
  }, [onUiAction, toolPart]);

  if (isTextUIPart(part)) {
    return (
      <Bubble
        align={role === "user" ? "end" : "start"}
        variant={role === "user" ? "muted" : "ghost"}
      >
        <BubbleContent>
          <MessageResponse>{part.text}</MessageResponse>
        </BubbleContent>
      </Bubble>
    );
  }

  if (part.type === "file") {
    return (
      <Attachment className="max-w-full" size="sm">
        <AttachmentMedia>
          <PaperclipIcon />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>{part.filename || "Attached file"}</AttachmentTitle>
          {part.mediaType ? (
            <AttachmentDescription>{part.mediaType}</AttachmentDescription>
          ) : null}
        </AttachmentContent>
      </Attachment>
    );
  }

  if (!toolPart || !toolName) return null;

  const approval = toolPart.approval;
  const hasInput =
    toolPart.input !== undefined &&
    (typeof toolPart.input !== "object" ||
      toolPart.input === null ||
      Object.keys(toolPart.input).length > 0);
  const title = toolTitle(toolName);

  return (
    <Tool open={open ?? active} onOpenChange={setOpen} className="w-full">
      {toolPart.type === "dynamic-tool" ? (
        <ToolHeader
          type="dynamic-tool"
          toolName={toolName}
          state={toolPart.state}
          title={title}
        />
      ) : (
        <ToolHeader type={toolPart.type} state={toolPart.state} title={title} />
      )}
      <ToolContent>
        {hasInput ? <ToolInput input={toolPart.input} /> : null}
        {approval &&
        toolPart.state === "approval-requested" &&
        !approval.isAutomatic ? (
          <Alert
            className="border-primary/30 bg-primary/5"
            role="status"
            aria-live="polite"
          >
            <ShieldAlert aria-hidden="true" />
            <AlertTitle>Approval required</AlertTitle>
            <AlertDescription>
              <p>{approvalDescription(toolName, toolPart.input)}</p>
              <p className="mt-1 text-xs">
                Review the parameters above before allowing this operation.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  disabled={approvalPendingId === approval.id}
                  onClick={() => approve(approval.id, false)}
                  size="sm"
                  variant="outline"
                >
                  <X data-icon="inline-start" />
                  Reject
                </Button>
                <Button
                  disabled={approvalPendingId === approval.id}
                  onClick={() => approve(approval.id, true)}
                  size="sm"
                >
                  {approvalPendingId === approval.id ? (
                    <Loader2
                      aria-hidden="true"
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : (
                    <Check data-icon="inline-start" />
                  )}
                  Approve
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
        {approval &&
        toolPart.state === "approval-requested" &&
        approval.isAutomatic ? (
          <div className="flex items-center gap-2 rounded-md border border-muted bg-muted/30 p-3 text-muted-foreground text-xs">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            Applying the approval decision…
          </div>
        ) : null}
        {toolPart.state === "output-available" ? (
          <UpGalToolOutput
            input={toolPart.input}
            name={toolName}
            onReplay={onReplay}
            output={toolPart.output}
          />
        ) : toolPart.state === "output-error" ? (
          <ToolOutput output={undefined} errorText={toolPart.errorText} />
        ) : toolPart.state === "output-denied" ? (
          <div className="flex items-start gap-2 rounded-md border border-muted bg-muted/30 p-3 text-muted-foreground text-xs">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4" />
            <span>
              {approval?.reason ||
                "This operation was not approved and was not run."}
            </span>
          </div>
        ) : null}
      </ToolContent>
    </Tool>
  );
}
