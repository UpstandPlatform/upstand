"use client";

import { Badge } from "@upstand/ui/components/badge";
import { cn } from "@upstand/ui/lib/utils";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";
import {
  CheckCircleIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "@/components/huge-icons";
import { CodeBlock } from "./code-block";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "./trace";

export type ToolProps = ComponentProps<typeof TraceCollapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <TraceCollapsible className={cn("w-full", className)} {...props} />
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = Omit<
  ComponentProps<typeof TraceCollapsibleTrigger>,
  "type"
> & {
  title?: string;
  className?: string;
  state: ToolPart["state"];
} & (
    | { type: ToolUIPart["type"]; toolName?: never }
    | {
        type: DynamicToolUIPart["type"];
        toolName: string;
      }
  );

const statusLabels: Record<ToolPart["state"], string> = {
  "approval-requested": "Awaiting Approval",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Completed",
  "output-denied": "Denied",
  "output-error": "Error",
};

const statusIcons: Record<ToolPart["state"], ReactNode> = {
  "approval-requested": <ClockIcon aria-hidden="true" className="size-4" />,
  "approval-responded": (
    <CheckCircleIcon aria-hidden="true" className="size-4" />
  ),
  "input-available": (
    <ClockIcon aria-hidden="true" className="size-4 animate-pulse" />
  ),
  "input-streaming": <CircleIcon aria-hidden="true" className="size-4" />,
  "output-available": <CheckCircleIcon aria-hidden="true" className="size-4" />,
  "output-denied": <XCircleIcon aria-hidden="true" className="size-4" />,
  "output-error": <XCircleIcon aria-hidden="true" className="size-4" />,
};

export const getStatusBadge = (status: ToolPart["state"]) => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[status]}
    {statusLabels[status]}
  </Badge>
);

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  ...props
}: ToolHeaderProps) => {
  const derivedName =
    type === "dynamic-tool"
      ? toolName || "Tool"
      : typeof type === "string"
        ? type.split("-").slice(1).join("-") || "Tool"
        : "Tool";

  const status =
    state === "input-streaming" ||
    state === "input-available" ||
    state === "approval-responded"
      ? "running"
      : state === "approval-requested"
        ? "pending"
        : state === "output-error"
          ? "error"
          : undefined;
  const action =
    state === "input-streaming"
      ? `Preparing ${title ?? derivedName}…`
      : state === "input-available" || state === "approval-responded"
        ? `Running ${title ?? derivedName}…`
        : state === "approval-requested"
          ? `Approval needed for ${title ?? derivedName}`
          : state === "output-error"
            ? `Failed: ${title ?? derivedName}`
            : state === "output-denied"
              ? `Not run: ${title ?? derivedName}`
              : `Completed ${title ?? derivedName}`;

  return (
    <TraceCollapsibleTrigger className={cn("w-full", className)} {...props}>
      <TraceLine status={status}>
        <TraceIcon>
          <WrenchIcon />
        </TraceIcon>
        <TraceTitle>{action}</TraceTitle>
      </TraceLine>
    </TraceCollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof TraceCollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <TraceCollapsibleContent
    className={cn("flex flex-col gap-4 text-foreground", className)}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div
    className={cn("flex flex-col gap-2 overflow-hidden", className)}
    {...props}
  >
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      Parameters
    </h4>
    <div className="overflow-hidden rounded-md bg-muted/50">
      <CodeBlock
        code={JSON.stringify(input ?? {}, null, 2) ?? "{}"}
        language="json"
      />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  errorText: ToolPart["errorText"];
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (output === undefined && !errorText) {
    return null;
  }

  let Output: ReactNode = null;

  if (
    output !== undefined &&
    typeof output === "object" &&
    !isValidElement(output)
  ) {
    Output = (
      <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
    );
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />;
  } else if (output !== undefined) {
    Output = <div className="p-3">{output as ReactNode}</div>;
  }

  return (
    <div className={cn("flex flex-col gap-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText
            ? "bg-destructive/10 text-destructive"
            : "bg-muted/50 text-foreground",
        )}
      >
        {errorText && <div className="p-3">{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};
