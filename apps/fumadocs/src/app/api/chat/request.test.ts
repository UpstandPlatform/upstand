import { describe, expect, test } from "bun:test";
import {
  MAX_CHAT_MESSAGES,
  parseChatRequest,
  readBoundedRequestBody,
} from "./request";

describe("documentation chat request limits", () => {
  test("rejects malformed and oversized message arrays", () => {
    expect(parseChatRequest("not-json")).toEqual({ error: "invalid_json" });
    expect(parseChatRequest(JSON.stringify({ messages: [] }))).toEqual({
      error: "invalid_shape",
    });
    expect(
      parseChatRequest(
        JSON.stringify({
          messages: Array.from({ length: MAX_CHAT_MESSAGES + 1 }),
        }),
      ),
    ).toEqual({ error: "invalid_shape" });
  });

  test("accepts a bounded chat request", () => {
    expect(
      parseChatRequest(
        JSON.stringify({
          messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
        }),
      ),
    ).toEqual({
      messages: [{ role: "user", parts: [{ type: "text", text: "Hi" }] }],
    });
  });

  test("bounds chunked request bodies before decoding them", async () => {
    const request = new Request("https://docs.example.test/api/chat", {
      method: "POST",
      body: "x".repeat(32),
    });

    await expect(readBoundedRequestBody(request, 16)).resolves.toEqual({
      body: null,
      tooLarge: true,
    });
  });
});
