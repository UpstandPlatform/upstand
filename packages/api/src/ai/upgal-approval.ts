import { createHash, createHmac, timingSafeEqual } from "node:crypto";

type ApprovalPart = {
  type?: unknown;
  state?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  input?: unknown;
  approval?: {
    id?: unknown;
    approved?: unknown;
    signature?: unknown;
  };
};

export type UpGalApprovalBinding = {
  conversationId: string;
  organizationId: string;
  userId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  approvalId: string;
};

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

function toBase64Url(value: Buffer): string {
  return value
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function createUpGalApprovalSignature(
  toolCallId: string,
  toolName: string,
  input: unknown,
  approvalId: string,
  secret: string,
): string {
  const inputDigest = toBase64Url(
    createHash("sha256").update(canonicalize(input)).digest(),
  );
  return toBase64Url(
    createHmac("sha256", secret)
      .update(
        JSON.stringify([
          "ai-sdk-tool-approval-v1",
          approvalId,
          toolCallId,
          toolName,
          inputDigest,
        ]),
      )
      .digest(),
  );
}

function sameSignature(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}

function asApprovalPart(value: unknown): ApprovalPart | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const part = value as ApprovalPart;
  if (!part.approval || typeof part.approval !== "object") return null;
  return part;
}

function toolName(part: ApprovalPart): string | null {
  if (typeof part.toolName === "string" && part.toolName.length > 0) {
    return part.toolName;
  }
  if (typeof part.type !== "string" || !part.type.startsWith("tool-")) {
    return null;
  }
  return part.type.slice("tool-".length) || null;
}

function toolCallId(part: ApprovalPart): string | null {
  return typeof part.toolCallId === "string" && part.toolCallId.length > 0
    ? part.toolCallId
    : null;
}

function approvalId(part: ApprovalPart): string | null {
  return typeof part.approval?.id === "string" && part.approval.id.length > 0
    ? part.approval.id
    : null;
}

function signature(part: ApprovalPart): string | null {
  return typeof part.approval?.signature === "string" &&
    part.approval.signature.length > 0
    ? part.approval.signature
    : null;
}

function messageParts(messages: ReadonlyArray<unknown>): ApprovalPart[] {
  return messages.flatMap((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return [];
    }
    const parts = (message as { parts?: unknown }).parts;
    return Array.isArray(parts)
      ? parts
          .map(asApprovalPart)
          .filter((part): part is ApprovalPart => part !== null)
      : [];
  });
}

/**
 * Verify approval continuations against the server-persisted pending tool
 * request. The SDK approval signature remains enabled, but this independent
 * binding makes a renamed/removed SDK option fail closed and prevents replay
 * after the persisted request has transitioned out of approval-requested.
 */
export function assertUpGalApprovalContinuations(input: {
  incomingMessages: ReadonlyArray<unknown>;
  persistedMessages: ReadonlyArray<unknown>;
  conversationId: string;
  organizationId: string;
  userId: string;
  secret: string;
}): void {
  if (!input.secret) throw new Error("UpGal approval secret is unavailable");

  const pendingParts = messageParts(input.persistedMessages).filter(
    (part) => part.state === "approval-requested",
  );
  const approvedParts = messageParts(input.incomingMessages).filter(
    (part) =>
      part.state === "approval-responded" && part.approval?.approved === true,
  );

  for (const approvedPart of approvedParts) {
    const approvedToolCallId = toolCallId(approvedPart);
    const approvedApprovalId = approvalId(approvedPart);
    const approvedToolName = toolName(approvedPart);
    if (!approvedToolCallId || !approvedApprovalId || !approvedToolName) {
      throw new Error("UpGal approval response is incomplete");
    }

    const pendingPart = pendingParts.find(
      (candidate) =>
        (approvedApprovalId !== null &&
          approvalId(candidate) === approvedApprovalId) ||
        (approvedToolCallId !== null &&
          toolCallId(candidate) === approvedToolCallId),
    );
    if (!pendingPart) {
      throw new Error("UpGal approval is not bound to a pending tool request");
    }

    const pendingToolCallId = toolCallId(pendingPart);
    const pendingApprovalId = approvalId(pendingPart);
    const pendingToolName = toolName(pendingPart);
    const pendingSignature = signature(pendingPart);
    const approvedSignature = signature(approvedPart);
    if (!pendingToolCallId || !pendingApprovalId || !pendingToolName) {
      throw new Error("Persisted UpGal approval request is incomplete");
    }
    if (!pendingSignature || !approvedSignature) {
      throw new Error("UpGal approval signature is missing");
    }

    const common = {
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      userId: input.userId,
    };
    const expected: UpGalApprovalBinding = {
      ...common,
      toolCallId: pendingToolCallId,
      toolName: pendingToolName,
      input: pendingPart.input,
      approvalId: pendingApprovalId,
    };
    const actual: UpGalApprovalBinding = {
      ...common,
      toolCallId: approvedToolCallId,
      toolName: approvedToolName,
      input: approvedPart.input,
      approvalId: approvedApprovalId,
    };
    const expectedSignature = createUpGalApprovalSignature(
      expected.toolCallId,
      expected.toolName,
      expected.input,
      expected.approvalId,
      input.secret,
    );
    const actualSignature = createUpGalApprovalSignature(
      actual.toolCallId,
      actual.toolName,
      actual.input,
      actual.approvalId,
      input.secret,
    );
    if (
      !sameSignature(expectedSignature, pendingSignature) ||
      !sameSignature(expectedSignature, approvedSignature) ||
      !sameSignature(expectedSignature, actualSignature)
    ) {
      throw new Error("UpGal approval binding was modified or replayed");
    }
  }
}
