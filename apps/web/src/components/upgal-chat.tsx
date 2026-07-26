"use client";

import { useChat } from "@ai-sdk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpGalUIAction, UpGalUIMessage } from "@upstand/api/ai/upgal";
import type { UpGalPageContext } from "@upstand/api/ai/upgal-page-context";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@upstand/ui/components/alert";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@upstand/ui/components/popover";
import { ScrollArea } from "@upstand/ui/components/scroll-area";
import type { FileUIPart } from "ai";
import {
  DefaultChatTransport,
  getToolName,
  isTextUIPart,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { UPGAL_ACCEPT_PATTERNS } from "@/lib/attachment-utils";
import type { UpGalDraftEventDetail } from "@/lib/upgal-events";

function UpGalDraftHandler({ onOpen }: { onOpen: () => void }) {
  const controller = usePromptInputController();

  useEffect(() => {
    const handleDraft = (e: Event) => {
      const customEvent = e as CustomEvent<UpGalDraftEventDetail>;
      const detail = customEvent.detail;
      if (!detail) return;

      onOpen();

      if (detail.content || detail.filename) {
        const filename = detail.filename || "attached-logs.txt";
        const content = detail.content || "";
        const mediaType = detail.mediaType || "text/plain";
        const file = new File([content], filename, { type: mediaType });
        controller.attachments.add([file]);
      }

      if (detail.prompt) {
        controller.textInput.setInput(detail.prompt);
      }
    };

    window.addEventListener("upgal:draft", handleDraft);
    return () => window.removeEventListener("upgal:draft", handleDraft);
  }, [controller, onOpen]);

  return null;
}

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import {
  Bot,
  Check,
  CircleAlert,
  History,
  Loader2,
  MessageCircle,
  PaperclipIcon,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from "@/components/huge-icons";
import { UpGalToolOutput } from "@/components/upgal-tool-output";
import { getServerApiUrl } from "@/lib/server-url";
import {
  collectUpGalUiTargets,
  consumeUpGalAction,
  isUpGalUIAction,
  removeUpGalPlan,
  replayUpGalPlan,
  storeUpGalPlan,
  upGalPlanUrl,
} from "@/lib/upgal-ui-actions";
import { trpc } from "@/utils/trpc";

type UpGalChatProps = {
  organizationId?: string;
  pageTitle?: string;
};

const conversationDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const toolTitles: Record<string, string> = {
  create_environment: "Create environment",
  create_project: "Create project",
  control_resource: "Change resource state",
  delete_project: "Delete project",
  delete_resource: "Delete resource",
  deploy_resource: "Deploy resource",
  create_tag: "Create tag",
  update_tag: "Update tag",
  delete_tag: "Delete tag",
  assign_resource_tag: "Assign resource tag",
  detach_resource_tag: "Detach resource tag",
  list_tags: "List tags",
  get_resource_tags: "Resource tags",
  search_web: "Web search",
  guide_upstand: "Open Upstand guidance",
};

function displayChatError(error: Error): {
  message: string;
  detail?: string;
  retryable: boolean;
} {
  if (error.message === "An error occurred.") {
    return {
      message: "The response ended before UpGal finished.",
      detail:
        "Completed tool results are still available above. Retry to continue from the latest conversation state.",
      retryable: true,
    };
  }
  return {
    message: error.message || "UpGal could not complete this request.",
    retryable: (error as Error & { retryable?: boolean }).retryable !== false,
  };
}

async function upGalFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.ok) return response;

  let message = "UpGal could not complete this request.";
  let retryable = true;
  try {
    const payload = (await response.clone().json()) as {
      error?: unknown;
      retryable?: unknown;
    };
    if (typeof payload.error === "string" && payload.error.trim()) {
      message = payload.error;
    }
    if (typeof payload.retryable === "boolean") retryable = payload.retryable;
  } catch {
    // Streaming responses and proxies do not always return JSON errors.
  }
  const error = new Error(message) as Error & { retryable?: boolean };
  error.retryable = retryable;
  throw error;
}

function toolTitle(name: string) {
  return toolTitles[name] ?? name.replaceAll("_", " ");
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

function Part({
  part,
  approve,
  approvalPendingId,
  onReplay,
  onUiAction,
}: {
  part: UpGalUIMessage["parts"][number];
  approve: (id: string, approved: boolean) => void;
  approvalPendingId?: string;
  onReplay?: (action: UpGalUIAction) => void;
  onUiAction?: (actionId: string, action: UpGalUIAction) => void;
}) {
  useEffect(() => {
    if (!isToolUIPart(part) || part.state !== "output-available") return;
    const candidate = part as typeof part & {
      output?: unknown;
      toolCallId?: string;
    };
    if (!candidate.toolCallId || !isUpGalUIAction(candidate.output)) return;
    onUiAction?.(candidate.toolCallId, candidate.output);
  }, [onUiAction, part]);

  if (isTextUIPart(part)) return <MessageResponse>{part.text}</MessageResponse>;
  if (isToolUIPart(part)) {
    const toolName = getToolName(part);
    const approval = part.approval;
    const hasInput =
      part.input !== undefined &&
      (typeof part.input !== "object" ||
        part.input === null ||
        Object.keys(part.input).length > 0);
    return (
      <Tool
        defaultOpen={part.state !== "output-available"}
        className="my-2 w-full"
      >
        {part.type === "dynamic-tool" ? (
          <ToolHeader
            type="dynamic-tool"
            toolName={toolName}
            state={part.state}
          />
        ) : (
          <ToolHeader type={part.type} state={part.state} />
        )}
        <ToolContent>
          {hasInput ? <ToolInput input={part.input} /> : null}
          {approval &&
          part.state === "approval-requested" &&
          !approval.isAutomatic ? (
            <Alert
              className="border-primary/30 bg-primary/5"
              role="status"
              aria-live="polite"
            >
              <ShieldAlert aria-hidden="true" />
              <AlertTitle>Approval required</AlertTitle>
              <AlertDescription>
                <p>{approvalDescription(toolName, part.input)}</p>
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
          part.state === "approval-requested" &&
          approval.isAutomatic ? (
            <div className="flex items-center gap-2 rounded-md border border-muted bg-muted/30 p-3 text-muted-foreground text-xs">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              Applying the approval decision…
            </div>
          ) : null}
          {part.state === "output-available" ? (
            <UpGalToolOutput
              input={part.input}
              name={toolName}
              onReplay={onReplay}
              output={part.output}
            />
          ) : part.state === "output-error" ? (
            <ToolOutput output={undefined} errorText={part.errorText} />
          ) : part.state === "output-denied" ? (
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
  return null;
}

function PromptInputDirectAttachButton() {
  const { openFileDialog } = usePromptInputAttachments();
  return (
    <PromptInputButton
      aria-label="Attach text or markdown file"
      tooltip="Attach text or markdown file"
      onClick={() => openFileDialog()}
    >
      <PaperclipIcon className="size-4" />
    </PromptInputButton>
  );
}

export function UpGalChat({ organizationId, pageTitle }: UpGalChatProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [approvalPendingId, setApprovalPendingId] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    title: string;
  }>();
  const queryClient = useQueryClient();
  const loadedConversationId = useRef<{ value?: string }>({});
  const loadRequestId = useRef(0);
  const previousOrganizationId = useRef(organizationId);
  const manualNewConversation = useRef(false);
  const replayUiAction = useCallback(
    (action: UpGalUIAction) => {
      const activePlanId = new URLSearchParams(window.location.search).get(
        "upgal_plan",
      );
      if (activePlanId) removeUpGalPlan(activePlanId);
      const planId = replayUpGalPlan(action);
      const firstNavigation = action.steps.find(
        (step) => step.type === "navigate",
      );
      const destination = upGalPlanUrl(
        firstNavigation?.path ?? pathname,
        planId,
      );
      router.push(destination as Route, { scroll: false });
    },
    [pathname, router],
  );
  const executeUiAction = useCallback(
    (actionId: string, action: UpGalUIAction) => {
      const activePlanId = new URLSearchParams(window.location.search).get(
        "upgal_plan",
      );
      if (activePlanId && activePlanId !== actionId) return;
      if (!consumeUpGalAction(actionId)) return;
      if (action.kind === "ui_action_plan") {
        const planId = actionId;
        storeUpGalPlan(planId, action);
        const firstNavigation = action.steps.find(
          (step) => step.type === "navigate",
        );
        const destinationPath = firstNavigation?.path ?? pathname;
        const destination = upGalPlanUrl(destinationPath, planId);
        router.push(destination as Route, { scroll: false });
        return;
      }
    },
    [pathname, router],
  );
  const createConversation = useMutation(
    trpc.ai.createConversation.mutationOptions(),
  );
  const deleteConversation = useMutation({
    ...trpc.ai.deleteConversation.mutationOptions(),
    onSuccess: (_, variables) => {
      void conversations.refetch();
      queryClient.removeQueries({
        queryKey: trpc.ai.getConversation.queryKey({
          organizationId: organizationId as string,
          conversationId: variables.conversationId,
        }),
      });
      if (variables.conversationId === conversationId) newConversation();
    },
  });
  const conversations = useQuery({
    ...trpc.ai.conversations.queryOptions({
      organizationId: organizationId as string,
    }),
    enabled: Boolean(organizationId),
  });

  const pageContext = useMemo<UpGalPageContext>(
    () => ({
      path: pathname,
      ...(pageTitle ? { title: pageTitle } : {}),
    }),
    [pageTitle, pathname],
  );
  const currentPageContext = useCallback(
    () => ({ ...pageContext, uiTargets: collectUpGalUiTargets() }),
    [pageContext],
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UpGalUIMessage>({
        // UpGal is served by the API origin in self-hosted deployments. Using
        // a relative URL sends the request to the dashboard instead.
        api: getServerApiUrl("/api/ai/chat"),
        credentials: "include",
        fetch: upGalFetch,
      }),
    [],
  );
  const chat = useChat<UpGalUIMessage>({
    transport,
    sendAutomaticallyWhen: ({ messages }) =>
      lastAssistantMessageIsCompleteWithApprovalResponses({ messages }),
    onError: (error) => {
      // Keep the SDK's typed error state for rendering while making failures
      // visible to the application logger during development.
      if (process.env.NODE_ENV !== "production") console.error(error);
    },
  });

  async function ensureConversation() {
    if (conversationId || !organizationId) return conversationId;
    const result = await createConversation.mutateAsync({
      organizationId,
      context: { page: currentPageContext() },
    });
    setConversationId(result.id);
    void conversations.refetch();
    return result.id;
  }

  const loadConversation = useCallback(
    async (id: string) => {
      if (!organizationId || loadedConversationId.current.value === id) return;
      const requestId = ++loadRequestId.current;
      try {
        chat.stop();
        setLoadError(undefined);
        const result = await queryClient.fetchQuery(
          trpc.ai.getConversation.queryOptions({
            organizationId,
            conversationId: id,
          }),
        );
        if (!result) {
          if (requestId !== loadRequestId.current) return;
          setLoadError("This conversation is no longer available.");
          return;
        }
        if (requestId !== loadRequestId.current) return;
        setConversationId(id);
        manualNewConversation.current = false;
        loadedConversationId.current.value = id;
        chat.setMessages(
          result.messages.map((message) => ({
            id: message.id,
            role: message.role as UpGalUIMessage["role"],
            parts: message.parts as UpGalUIMessage["parts"],
          })),
        );
        setHistoryOpen(false);
      } catch (error) {
        if (requestId !== loadRequestId.current) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "Unable to load this conversation.",
        );
      }
    },
    [chat, organizationId, queryClient],
  );

  useEffect(() => {
    if (previousOrganizationId.current !== organizationId) {
      previousOrganizationId.current = organizationId;
      loadRequestId.current += 1;
      setConversationId(undefined);
      loadedConversationId.current.value = undefined;
      manualNewConversation.current = false;
      chat.setMessages([]);
      setLoadError(undefined);
      setApprovalPendingId(undefined);
      chat.clearError();
    }
  }, [chat, organizationId]);

  useEffect(() => {
    if (
      !organizationId ||
      !open ||
      conversationId ||
      manualNewConversation.current ||
      !conversations.data?.[0]
    )
      return;
    void loadConversation(conversations.data[0].id);
  }, [
    conversationId,
    conversations.data,
    loadConversation,
    open,
    organizationId,
  ]);

  async function send(text: string, files?: FileUIPart[]) {
    const trimmedText = text.trim();
    if ((!trimmedText && (!files || files.length === 0)) || !organizationId)
      return;
    const id = await ensureConversation();
    await chat.sendMessage(
      { text: trimmedText, files },
      {
        body: {
          organizationId,
          conversationId: id,
          page: currentPageContext(),
        },
      },
    );
  }

  function newConversation() {
    loadRequestId.current += 1;
    chat.stop();
    setConversationId(undefined);
    loadedConversationId.current.value = undefined;
    manualNewConversation.current = true;
    chat.setMessages([]);
    setLoadError(undefined);
    chat.clearError();
    setApprovalPendingId(undefined);
    setHistoryOpen(false);
  }

  function respondToApproval(id: string, approved: boolean) {
    setApprovalPendingId(id);
    void (async () => {
      try {
        await chat.addToolApprovalResponse({
          id,
          approved,
          options: {
            body: {
              organizationId,
              conversationId,
              page: currentPageContext(),
            },
          },
        });
      } finally {
        setApprovalPendingId(undefined);
      }
    })();
  }

  return (
    <PromptInputProvider>
      <UpGalDraftHandler onOpen={() => setOpen(true)} />
      {!open ? (
        <Button
          aria-label="Open UpGal assistant"
          className="fixed right-5 bottom-5 z-70 size-14 rounded-full shadow-lg"
          onClick={() => setOpen(true)}
        >
          <MessageCircle className="size-6" />
        </Button>
      ) : (
        <section className="fixed inset-x-3 bottom-3 z-70 flex h-[min(720px,calc(100svh-24px))] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl sm:inset-x-auto sm:right-5 sm:w-110">
          <header className="flex items-center gap-3 border-b px-4 py-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Bot className="size-5" />
            </div>
            <div className="mr-auto flex-1">
              <p className="font-semibold">UpGal</p>
              <p className="text-muted-foreground text-xs">
                Your Upstand operations assistant
              </p>
            </div>
            <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
              <PopoverTrigger
                render={
                  <Button
                    aria-label="Conversation history"
                    size="icon"
                    variant="ghost"
                  />
                }
              >
                <History className="size-4" />
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-[min(88vw,340px)] gap-2 p-2"
                positionerClassName="z-[80]"
              >
                <div className="flex items-center justify-between px-2 py-1">
                  <p className="font-semibold text-sm">
                    Previous conversations
                  </p>
                  {conversations.isFetching ? (
                    <Loader2
                      aria-hidden="true"
                      className="size-3 animate-spin"
                    />
                  ) : null}
                </div>
                <ScrollArea className="max-h-64">
                  <div className="flex flex-col gap-1">
                    {conversations.data?.length ? (
                      conversations.data.map((conversation) => (
                        <div
                          key={conversation.id}
                          className="group flex items-center gap-1 rounded-2xl px-2 py-1.5 hover:bg-muted"
                        >
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() =>
                              void loadConversation(conversation.id)
                            }
                          >
                            <span className="block truncate font-medium text-sm">
                              {conversation.title || "UpGal conversation"}
                            </span>
                            <span className="block text-[11px] text-muted-foreground">
                              {conversationDateFormatter.format(
                                new Date(conversation.updatedAt),
                              )}
                            </span>
                          </button>
                          <Button
                            aria-label={`Remove ${conversation.title || "conversation"}`}
                            size="icon-sm"
                            variant="ghost"
                            onClick={() =>
                              setDeleteTarget({
                                id: conversation.id,
                                title:
                                  conversation.title || "UpGal conversation",
                              })
                            }
                            disabled={deleteConversation.isPending}
                          >
                            <Trash2 className="size-3.5 text-destructive" />
                          </Button>
                        </div>
                      ))
                    ) : (
                      <p className="px-2 py-6 text-center text-muted-foreground text-xs">
                        No saved conversations yet.
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
            <Button
              aria-label="New conversation"
              size="icon"
              variant="ghost"
              onClick={newConversation}
            >
              <Plus className="size-4" />
            </Button>
            <Button
              aria-label="Close UpGal"
              size="icon"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </header>
          <Conversation className="min-h-0 flex-1">
            <ConversationContent className="gap-4 p-4">
              {chat.messages.length === 0 ? (
                <ConversationEmptyState
                  icon={<Bot className="size-8" />}
                  title="What should I inspect?"
                  description="Ask UpGal to list projects, inspect environments, read logs, or check Docker. Any change requires your approval."
                />
              ) : null}
              {chat.messages.map((message) => (
                <Message key={message.id} from={message.role}>
                  <MessageContent>
                    {message.parts.map((part, index) => (
                      <Part
                        key={`${message.id}-${index}`}
                        part={part}
                        approve={respondToApproval}
                        approvalPendingId={approvalPendingId}
                        onReplay={replayUiAction}
                        onUiAction={executeUiAction}
                      />
                    ))}
                  </MessageContent>
                </Message>
              ))}
              {chat.status === "submitted" || chat.status === "streaming" ? (
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <Loader2 aria-hidden="true" className="size-3 animate-spin" />
                  UpGal is inspecting your infrastructure…
                </div>
              ) : null}
              {loadError ? (
                <Alert variant="destructive">
                  <AlertTitle>Conversation unavailable</AlertTitle>
                  <AlertDescription>{loadError}</AlertDescription>
                </Alert>
              ) : null}
              {chat.error ? (
                <Alert variant="destructive">
                  <CircleAlert aria-hidden="true" />
                  <AlertTitle>UpGal response interrupted</AlertTitle>
                  <AlertDescription>
                    <div className="space-y-1">
                      <p>{displayChatError(chat.error).message}</p>
                      {displayChatError(chat.error).detail ? (
                        <p className="text-xs">
                          {displayChatError(chat.error).detail}
                        </p>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {displayChatError(chat.error).retryable ? (
                        <Button
                          onClick={() =>
                            void chat.regenerate({
                              body: {
                                organizationId,
                                conversationId,
                                page: currentPageContext(),
                              },
                            })
                          }
                          size="sm"
                          variant="outline"
                        >
                          Retry response
                        </Button>
                      ) : null}
                      <Button
                        onClick={() => chat.clearError()}
                        size="sm"
                        variant="ghost"
                      >
                        Dismiss
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              ) : null}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
          <PromptInput
            accept={UPGAL_ACCEPT_PATTERNS}
            className="border-t p-3"
            onSubmit={({ text, files }) => send(text, files)}
          >
            <PromptInputHeader>
              <PromptInputAttachments />
            </PromptInputHeader>
            <PromptInputBody>
              <PromptInputTextarea
                placeholder="Ask UpGal anything…"
                className="min-h-12 resize-none"
                aria-label="Message UpGal"
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputDirectAttachButton />
              </PromptInputTools>
              <span className="px-2 text-[11px] text-muted-foreground">
                Shift + Enter for a new line
              </span>
              <PromptInputSubmit
                status={chat.status}
                onStop={() => chat.stop()}
              />
            </PromptInputFooter>
          </PromptInput>
        </section>
      )}
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(undefined);
        }}
        open={Boolean(deleteTarget)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.title}” and its saved tool results will be
              permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteTarget || !organizationId) return;
                deleteConversation.mutate({
                  organizationId,
                  conversationId: deleteTarget.id,
                });
                setDeleteTarget(undefined);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PromptInputProvider>
  );
}
