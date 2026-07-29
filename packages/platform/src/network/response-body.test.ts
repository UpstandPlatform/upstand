import { describe, expect, test } from "bun:test";
import {
  readResponseBodyLimited,
  readResponseJsonLimited,
} from "./response-body";

describe("response body limits", () => {
  test("rejects an oversized declared content length before reading", async () => {
    const response = new Response("small", {
      headers: { "content-length": "100" },
    });

    await expect(readResponseBodyLimited(response, 10)).rejects.toThrow(
      "Upstream response is too large",
    );
    expect(response.bodyUsed).toBe(true);
  });

  test("rejects an oversized chunked response while streaming", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(6));
          controller.enqueue(new Uint8Array(6));
          controller.close();
        },
      }),
    );

    await expect(readResponseBodyLimited(response, 10)).rejects.toThrow(
      "Upstream response is too large",
    );
  });

  test("parses bounded JSON responses", async () => {
    const response = new Response(JSON.stringify({ ok: true }));

    await expect(
      readResponseJsonLimited<{ ok: boolean }>(response, 1024),
    ).resolves.toEqual({ ok: true });
  });
});
