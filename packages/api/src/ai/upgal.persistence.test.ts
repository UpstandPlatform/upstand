import { describe, expect, test } from "bun:test";
import type { AIMessageRecord, IAIRepository } from "@upstand/domain";
import { saveIncomingMessages, validateAndRecoverUpGalMessages } from "./upgal";

function textMessage(id: string, role: "user" | "assistant", text: string) {
  return {
    id,
    role,
    parts: [{ type: "text", text }],
  } as never;
}

function createRepository() {
  let records: AIMessageRecord[] = [];
  let saveCount = 0;
  const repository = {
    listMessages: async () => records,
    saveMessages: async (
      _conversationId: string,
      messages: readonly AIMessageRecord[],
    ) => {
      saveCount += 1;
      records = messages.map((message) => ({ ...message }));
    },
    updateConversationTitle: async () => undefined,
  } as unknown as IAIRepository;

  return {
    repository,
    get records() {
      return records;
    },
    get saveCount() {
      return saveCount;
    },
  };
}

describe("UpGal message persistence", () => {
  test("keeps message timestamps stable when full history is replayed", async () => {
    const state = createRepository();
    const userMessage = textMessage("user-1", "user", "List projects");

    await saveIncomingMessages(
      "conversation-1",
      [userMessage],
      state.repository,
    );
    const firstCreatedAt = state.records[0]?.createdAt;

    await saveIncomingMessages(
      "conversation-1",
      [
        userMessage,
        textMessage("assistant-1", "assistant", "Here are the projects"),
      ],
      state.repository,
    );

    expect(state.records.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-1",
    ]);
    expect(state.records[0]?.createdAt).toEqual(firstCreatedAt);
    expect(state.records[1]?.createdAt.getTime()).toBeGreaterThan(
      firstCreatedAt?.getTime() ?? 0,
    );
  });

  test("serializes overlapping snapshots so an older write cannot win", async () => {
    const state = createRepository();
    const originalSaveMessages = state.repository.saveMessages.bind(
      state.repository,
    );
    state.repository.saveMessages = async (...args) => {
      if (state.saveCount === 0) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return originalSaveMessages(...args);
    };

    const userMessage = textMessage("user-1", "user", "List projects");
    const assistantMessage = textMessage(
      "assistant-1",
      "assistant",
      "Here are the projects",
    );

    await Promise.all([
      saveIncomingMessages("conversation-2", [userMessage], state.repository),
      saveIncomingMessages(
        "conversation-2",
        [userMessage, assistantMessage],
        state.repository,
      ),
    ]);

    expect(state.records.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-1",
    ]);
    expect(state.saveCount).toBe(2);
  });

  test("recovers a user turn when a stale tool part no longer validates", async () => {
    const recovered = await validateAndRecoverUpGalMessages(
      [
        textMessage("user-1", "user", "List projects"),
        {
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "tool-removed_tool",
              toolCallId: "call-1",
              state: "input-available",
              input: {},
            },
          ],
        },
      ],
      {} as ReturnType<typeof import("./upgal").createUpGalTools>,
    );

    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.role).toBe("user");
    expect(recovered[0]?.parts[0]).toEqual({
      type: "text",
      text: "List projects",
    });
  });
});
