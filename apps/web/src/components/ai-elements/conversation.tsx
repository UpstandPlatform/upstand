"use client";

import { Button } from "@upstand/ui/components/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@upstand/ui/components/message-scroller";
import { cn } from "@upstand/ui/lib/utils";
import type { UIMessage } from "ai";
import type { ComponentProps } from "react";
import { useCallback } from "react";
import { DownloadIcon } from "@/components/huge-icons";

export type ConversationProps = ComponentProps<typeof MessageScroller>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <MessageScrollerProvider autoScroll>
    <MessageScroller
      className={cn("relative flex-1", className)}
      role="log"
      {...props}
    />
  </MessageScrollerProvider>
);

export type ConversationContentProps = ComponentProps<
  typeof MessageScrollerContent
>;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <MessageScrollerViewport className="min-h-0 flex-1">
    <MessageScrollerContent className={cn("gap-6 p-4", className)} {...props} />
  </MessageScrollerViewport>
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="flex flex-col gap-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = {
  className?: string;
};

export const ConversationScrollButton = ({
  className,
}: ConversationScrollButtonProps) => (
  <MessageScrollerButton
    className={cn("bottom-4", className)}
    size="icon"
    variant="outline"
  />
);

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

export type ConversationDownloadProps = Omit<
  ComponentProps<typeof Button>,
  "onClick"
> & {
  messages: UIMessage[];
  filename?: string;
  formatMessage?: (message: UIMessage, index: number) => string;
};

const defaultFormatMessage = (message: UIMessage): string => {
  const roleLabel =
    message.role.charAt(0).toUpperCase() + message.role.slice(1);
  return `**${roleLabel}:** ${getMessageText(message)}`;
};

export const messagesToMarkdown = (
  messages: UIMessage[],
  formatMessage: (
    message: UIMessage,
    index: number,
  ) => string = defaultFormatMessage,
): string => messages.map((msg, i) => formatMessage(msg, i)).join("\n\n");

export const ConversationDownload = ({
  messages,
  filename = "conversation.md",
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) => {
  const handleDownload = useCallback(() => {
    const markdown = messagesToMarkdown(messages, formatMessage);
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [messages, filename, formatMessage]);

  return (
    <Button
      className={cn(
        "absolute top-4 right-4 rounded-full dark:bg-background dark:hover:bg-muted",
        className,
      )}
      onClick={handleDownload}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <DownloadIcon className="size-4" />}
    </Button>
  );
};
