"use client";

import { Alert, AlertDescription } from "@upstand/ui/components/alert";
import type { ChatStatus, FileUIPart } from "ai";
import {
  PromptInput,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { PaperclipIcon } from "@/components/huge-icons";
import {
  UPGAL_ACCEPT_PATTERNS,
  UPGAL_MAX_ATTACHMENT_COUNT,
  UPGAL_MAX_ATTACHMENT_SIZE_BYTES,
} from "@/lib/attachment-utils";

export type UpGalComposerProps = {
  hasProvider: boolean;
  isPreparing: boolean;
  isLoadingConversation: boolean;
  status: ChatStatus;
  error?: string;
  onClearError: () => void;
  onError: (message: string) => void;
  onSubmit: (text: string, files: FileUIPart[]) => Promise<void>;
  onStop: () => void;
};

function AttachButton({ disabled }: { disabled: boolean }) {
  const { openFileDialog } = usePromptInputAttachments();

  return (
    <PromptInputButton
      aria-label="Attach a text or Markdown file"
      disabled={disabled}
      tooltip="Attach a text or Markdown file"
      onClick={openFileDialog}
    >
      <PaperclipIcon />
    </PromptInputButton>
  );
}

export function UpGalComposer({
  hasProvider,
  isPreparing,
  isLoadingConversation,
  status,
  error,
  onClearError,
  onError,
  onSubmit,
  onStop,
}: UpGalComposerProps) {
  const isBusy =
    isPreparing ||
    isLoadingConversation ||
    status === "submitted" ||
    status === "streaming";

  return (
    <div className="border-t bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      {error ? (
        <Alert className="mb-3 py-2" role="alert" variant="destructive">
          <AlertDescription id="upgal-composer-error">{error}</AlertDescription>
        </Alert>
      ) : null}
      <PromptInput
        accept={UPGAL_ACCEPT_PATTERNS}
        className="rounded-xl border bg-card shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-ring/20"
        maxFileSize={UPGAL_MAX_ATTACHMENT_SIZE_BYTES}
        maxFiles={UPGAL_MAX_ATTACHMENT_COUNT}
        onError={({ message }) => onError(message)}
        onSubmit={({ text, files }) => onSubmit(text, files)}
      >
        <PromptInputHeader>
          <PromptInputAttachments />
        </PromptInputHeader>
        <PromptInputBody>
          <PromptInputTextarea
            aria-describedby={
              error
                ? "upgal-composer-error upgal-composer-hint"
                : "upgal-composer-hint"
            }
            aria-label="Message UpGal"
            aria-invalid={Boolean(error)}
            id="upgal-composer-input"
            autoComplete="off"
            className="min-h-14 resize-none px-4 py-3 text-sm leading-relaxed"
            disabled={isBusy}
            onChange={onClearError}
            placeholder={
              isLoadingConversation
                ? "Loading conversation…"
                : hasProvider
                  ? "Ask UpGal to inspect your infrastructure…"
                  : "Configure an AI provider to start chatting"
            }
          />
        </PromptInputBody>
        <PromptInputFooter className="min-h-11 px-2 pb-2">
          <PromptInputTools>
            <AttachButton disabled={isBusy || !hasProvider} />
          </PromptInputTools>
          <span
            className="min-w-0 flex-1 px-2 text-[11px] text-muted-foreground"
            id="upgal-composer-hint"
          >
            {hasProvider
              ? `Enter to send · Shift + Enter for a new line · Up to ${UPGAL_MAX_ATTACHMENT_COUNT} text files (${Math.floor(UPGAL_MAX_ATTACHMENT_SIZE_BYTES / 1024)} KB each)`
              : "Add a provider in UpGal Settings to enable chat"}
          </span>
          <PromptInputSubmit
            aria-label={isPreparing ? "Preparing message" : undefined}
            disabled={!hasProvider || isPreparing || isLoadingConversation}
            status={isPreparing ? "submitted" : status}
            onStop={onStop}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
