import { describe, expect, test } from "bun:test";
import {
  assertUpGalApprovalContinuations,
  createUpGalApprovalSignature,
} from "./upgal-approval";

const context = {
  conversationId: "conversation-1",
  organizationId: "organization-1",
  userId: "user-1",
  secret: "approval-secret-that-is-long-enough-for-tests",
};

function messages(input: unknown, approved: boolean) {
  const approvalId = "approval-1";
  const toolCallId = "tool-call-1";
  const signature = createUpGalApprovalSignature(
    toolCallId,
    "delete_resource",
    input,
    approvalId,
    context.secret,
  );
  return [
    {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "tool-delete_resource",
          state: approved ? "approval-responded" : "approval-requested",
          toolCallId,
          input,
          approval: {
            id: approvalId,
            signature,
            ...(approved ? { approved } : {}),
          },
        },
      ],
    },
  ];
}

describe("UpGal approval binding", () => {
  test("accepts an unchanged approval continuation", () => {
    expect(() =>
      assertUpGalApprovalContinuations({
        ...context,
        persistedMessages: messages({ id: "resource-1" }, false),
        incomingMessages: messages({ id: "resource-1" }, true),
      }),
    ).not.toThrow();
  });

  test("rejects a continuation whose tool input was changed", () => {
    expect(() =>
      assertUpGalApprovalContinuations({
        ...context,
        persistedMessages: messages({ id: "resource-1" }, false),
        incomingMessages: messages({ id: "other-resource" }, true),
      }),
    ).toThrow("modified or replayed");
  });

  test("rejects a forged SDK approval signature", () => {
    const incoming = messages({ id: "resource-1" }, true);
    const approval = incoming.at(0)?.parts.at(0)?.approval;
    if (!approval) throw new Error("test approval was not created");
    approval.signature = "forged";
    expect(() =>
      assertUpGalApprovalContinuations({
        ...context,
        persistedMessages: messages({ id: "resource-1" }, false),
        incomingMessages: incoming,
      }),
    ).toThrow("modified or replayed");
  });

  test("rejects an approval without a persisted pending request", () => {
    expect(() =>
      assertUpGalApprovalContinuations({
        ...context,
        persistedMessages: [],
        incomingMessages: messages({ id: "resource-1" }, true),
      }),
    ).toThrow("pending tool request");
  });
});
