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
import { Badge } from "@upstand/ui/components/badge";
import { Button } from "@upstand/ui/components/button";
import {
  Marker,
  MarkerContent,
  MarkerIcon,
} from "@upstand/ui/components/marker";
import { MessageScrollerItem } from "@upstand/ui/components/message-scroller";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@upstand/ui/components/popover";
import { ScrollArea } from "@upstand/ui/components/scroll-area";
import type { FileUIPart } from "ai";
import {
  DefaultChatTransport,
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
  PromptInputProvider,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import {
  Bot,
  CircleAlert,
  History,
  Loader2,
  MessageCircle,
  Plus,
  Trash2,
  X,
} from "@/components/huge-icons";
import { UpGalComposer } from "@/components/upgal-composer";
import { UpGalMessage } from "@/components/upgal-message";
import {
  matchesAcceptPattern,
  UPGAL_ACCEPT_PATTERNS,
  UPGAL_MAX_ATTACHMENT_COUNT,
  UPGAL_MAX_ATTACHMENT_SIZE_BYTES,
} from "@/lib/attachment-utils";
import { getServerApiUrl } from "@/lib/server-url";
import type { UpGalDraftEventDetail } from "@/lib/upgal-events";
import {
  collectUpGalUiTargets,
  consumeUpGalAction,
  removeUpGalPlan,
  replayUpGalPlan,
  storeUpGalPlan,
  upGalPlanUrl,
} from "@/lib/upgal-ui-actions";
import { trpc } from "@/utils/trpc";

function UpGalDraftHandler({
  onOpen,
  onError,
}: {
  onOpen: () => void;
  onError: (message: string) => void;
}) {
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
        if (!matchesAcceptPattern(file, UPGAL_ACCEPT_PATTERNS)) {
          onError(
            "Attach a supported text, Markdown, log, JSON, YAML, or CSV file.",
          );
        } else if (file.size > UPGAL_MAX_ATTACHMENT_SIZE_BYTES) {
          onError(
            `Each text attachment must be no larger than ${Math.floor(UPGAL_MAX_ATTACHMENT_SIZE_BYTES / 1024)} KB.`,
          );
        } else if (
          controller.attachments.files.length >= UPGAL_MAX_ATTACHMENT_COUNT
        ) {
          onError(`You can attach up to ${UPGAL_MAX_ATTACHMENT_COUNT} files.`);
        } else {
          controller.attachments.add([file]);
        }
      }

      if (detail.prompt) {
        controller.textInput.setInput(detail.prompt);
      }
    };

    window.addEventListener("upgal:draft", handleDraft);
    return () => window.removeEventListener("upgal:draft", handleDraft);
  }, [controller, onError, onOpen]);

  return null;
}

type UpGalChatProps = {
  organizationId?: string;
  pageTitle?: string;
};

const conversationDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

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

export function UpGalChat({ organizationId, pageTitle }: UpGalChatProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [composerError, setComposerError] = useState<string>();
  const [isPreparingMessage, setIsPreparingMessage] = useState(false);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [composerScopeRevision, setComposerScopeRevision] = useState(0);
  const [approvalPendingId, setApprovalPendingId] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    title: string;
  }>();
  const openAssistant = useCallback(() => setOpen(true), []);
  const assistantLauncherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
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
  const aiProviders = useQuery({
    ...trpc.ai.listProviders.queryOptions({
      organizationId: organizationId as string,
    }),
    enabled: Boolean(organizationId),
  });

  const hasAiProvider = Boolean(
    aiProviders.data?.some(
      (provider) => provider.configured && provider.enabled,
    ),
  );

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

  useEffect(() => {
    if (open) {
      const targetId = isLoadingConversation
        ? "upgal-close"
        : "upgal-composer-input";
      document.getElementById(targetId)?.focus({ preventScroll: true });
    } else if (wasOpen.current) {
      assistantLauncherRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [isLoadingConversation, open]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UpGalUIMessage>({
        // UpGal is served by the API origin in self-hosted deployments. Using
        // a relative URL sends the request to the dashboard instead.
        api: getServerApiUrl("/api/ai/chat"),
        credentials: "include",
        fetch: upGalFetch as typeof fetch,
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
  const hasActiveToolCall = chat.messages.some((message) =>
    message.parts.some(
      (part) =>
        isToolUIPart(part) &&
        (part.state === "input-streaming" ||
          part.state === "input-available" ||
          part.state === "approval-responded"),
    ),
  );
  const showThinkingStatus =
    isPreparingMessage ||
    ((chat.status === "submitted" || chat.status === "streaming") &&
      !hasActiveToolCall);

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
        setIsLoadingConversation(true);
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
        setComposerScopeRevision((revision) => revision + 1);
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
      } finally {
        if (requestId === loadRequestId.current) {
          setIsLoadingConversation(false);
        }
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
      setComposerError(undefined);
      setIsPreparingMessage(false);
      setIsLoadingConversation(false);
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

  async function send(text: string, files: FileUIPart[] = []) {
    const trimmedText = text.trim();
    if (
      (!trimmedText && files.length === 0) ||
      !organizationId ||
      !hasAiProvider
    )
      return;
    setComposerError(undefined);
    setIsPreparingMessage(true);
    let id: string | undefined;
    try {
      id = await ensureConversation();
    } catch (error) {
      setComposerError(
        error instanceof Error
          ? error.message
          : "UpGal could not start a conversation. Please try again.",
      );
      throw error;
    } finally {
      setIsPreparingMessage(false);
    }
    if (!id) return;
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
    setIsLoadingConversation(false);
    setConversationId(undefined);
    setComposerScopeRevision((revision) => revision + 1);
    loadedConversationId.current.value = undefined;
    manualNewConversation.current = true;
    chat.setMessages([]);
    setLoadError(undefined);
    setComposerError(undefined);
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
    <PromptInputProvider
      key={`${organizationId ?? "no-organization"}:${composerScopeRevision}`}
    >
      <UpGalDraftHandler onError={setComposerError} onOpen={openAssistant} />
      {!open ? (
        <Button
          aria-label="Open UpGal assistant"
          aria-controls="upgal-chat-panel"
          aria-expanded={open}
          aria-haspopup="dialog"
          className="fixed right-5 bottom-5 z-40 size-14 rounded-2xl shadow-lg transition-[transform,box-shadow] duration-200 hover:scale-105 hover:shadow-xl focus-visible:ring-4 focus-visible:ring-ring/30 active:scale-95 motion-reduce:transition-none"
          onClick={openAssistant}
          ref={assistantLauncherRef}
        >
          <MessageCircle className="size-6" />
        </Button>
      ) : (
        <section
          id="upgal-chat-panel"
          aria-label="UpGal assistant"
          aria-labelledby="upgal-title"
          aria-modal="false"
          className="fade-in slide-in-from-bottom-3 zoom-in-95 sm:slide-in-from-right-3 fixed inset-x-3 bottom-3 z-40 flex h-[min(720px,calc(100dvh-24px))] animate-in flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl duration-200 motion-reduce:animate-none sm:inset-x-auto sm:right-5 sm:w-[min(28rem,calc(100vw-2.5rem))]"
          role="dialog"
        >
          <header className="flex shrink-0 items-center gap-3 border-b bg-background/90 px-4 py-3 backdrop-blur">
            <div className="flex size-9 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Bot className="size-5" />
            </div>
            <div className="mr-auto flex-1">
              <p className="font-semibold leading-tight" id="upgal-title">
                UpGal
              </p>
              <p className="text-muted-foreground text-xs">
                Your Upstand operations assistant
              </p>
            </div>
            <Badge
              className="hidden shrink-0 font-normal sm:inline-flex"
              variant={hasAiProvider ? "secondary" : "outline"}
            >
              {aiProviders.isPending
                ? "Checking setup"
                : hasAiProvider
                  ? "Ready"
                  : "Setup needed"}
            </Badge>
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
                positionerClassName="z-50"
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
              id="upgal-close"
              size="icon"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </header>
          <Conversation className="min-h-0 flex-1">
            <ConversationContent className="gap-4 p-4">
              {chat.messages.length === 0 && !isLoadingConversation ? (
                <ConversationEmptyState>
                  <div className="text-muted-foreground">
                    <Bot className="size-8" />
                  </div>
                  <div className="flex max-w-sm flex-col gap-2">
                    <h3 className="font-medium text-base">
                      What should I inspect?
                    </h3>
                    <p className="text-muted-foreground text-sm">
                      Ask UpGal to list projects, inspect environments, read
                      logs, or check Docker. Any change requires your approval.
                    </p>
                  </div>
                  {hasAiProvider ? (
                    <div className="flex max-w-sm flex-wrap justify-center gap-2 pt-1">
                      {[
                        "Check recent deployments",
                        "Inspect Docker health",
                        "Find recent errors",
                      ].map((prompt) => (
                        <Button
                          key={prompt}
                          className="rounded-full text-xs"
                          disabled={isPreparingMessage}
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void send(prompt).catch(() => undefined)
                          }
                        >
                          {prompt}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                  {!hasAiProvider && !aiProviders.isPending ? (
                    <Button
                      title="Add Provider"
                      variant="outline"
                      size="sm"
                      className="mt-2 gap-1.5"
                      onClick={() => {
                        window.dispatchEvent(
                          new CustomEvent("open-settings-dialog", {
                            detail: { page: "upgal" },
                          }),
                        );
                      }}
                    >
                      <Plus className="size-4" />
                      Add Provider
                    </Button>
                  ) : null}
                </ConversationEmptyState>
              ) : null}
              {chat.messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user"}
                >
                  <UpGalMessage
                    message={message}
                    approve={respondToApproval}
                    approvalPendingId={approvalPendingId}
                    onReplay={replayUiAction}
                    onUiAction={executeUiAction}
                  />
                </MessageScrollerItem>
              ))}
              {isLoadingConversation || showThinkingStatus ? (
                <Marker aria-live="polite" className="px-1" role="status">
                  <MarkerIcon>
                    <Loader2 className="animate-spin" />
                  </MarkerIcon>
                  <MarkerContent>
                    {isLoadingConversation
                      ? "Loading conversation…"
                      : isPreparingMessage
                        ? "Preparing your conversation…"
                        : "UpGal is reviewing your request…"}
                  </MarkerContent>
                </Marker>
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
          <UpGalComposer
            error={composerError}
            hasProvider={hasAiProvider}
            isPreparing={isPreparingMessage}
            isLoadingConversation={isLoadingConversation}
            status={chat.status}
            onClearError={() => setComposerError(undefined)}
            onError={setComposerError}
            onSubmit={send}
            onStop={() => chat.stop()}
          />
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
