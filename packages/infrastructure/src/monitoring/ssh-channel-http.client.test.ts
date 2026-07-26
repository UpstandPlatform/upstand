import { describe, expect, test } from "bun:test";
import { Duplex } from "node:stream";
import { requestHttpOverSshChannel } from "./ssh-channel-http.client";

class FakeSshChannel extends Duplex {
  readonly requestChunks: Buffer[] = [];

  constructor(private readonly responseChunks: Buffer[] = []) {
    super();
  }

  _read() {}

  _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.requestChunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
    );
    for (const responseChunk of this.responseChunks) this.push(responseChunk);
    if (this.responseChunks.length > 0) this.push(null);
    callback();
  }
}

function httpResponse(
  statusLine: string,
  headers: string[],
  body: string,
): Buffer {
  return Buffer.from(
    [
      statusLine,
      ...headers,
      `Content-Length: ${Buffer.byteLength(body)}`,
      "Connection: close",
      "",
      body,
    ].join("\r\n"),
  );
}

describe("requestHttpOverSshChannel", () => {
  test("sends a request over the channel and parses a JSON response", async () => {
    const body = JSON.stringify({ status: "ok" });
    const channel = new FakeSshChannel([
      httpResponse("HTTP/1.1 200 OK", ["Content-Type: application/json"], body),
    ]);

    const result = await requestHttpOverSshChannel<{ status: string }>(
      channel,
      {
        method: "POST",
        path: "/config/thresholds",
        token: "test-token",
        body: { cpu: 80, memory: 85 },
      },
    );

    expect(result).toEqual({ status: "ok" });
    const request = Buffer.concat(channel.requestChunks).toString("utf8");
    expect(request).toContain("POST /config/thresholds HTTP/1.1");
    expect(request).toContain("Authorization: Bearer test-token");
    expect(request).toContain('{"cpu":80,"memory":85}');
  });

  test("parses a fragmented chunked response", async () => {
    const response = Buffer.from(
      'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n7\r\n{"statu\r\n8\r\ns":"ok"}\r\n0\r\n\r\n',
    );
    const channel = new FakeSshChannel(
      Array.from({ length: response.length }, (_, index) =>
        response.subarray(index, index + 1),
      ),
    );

    const result = await requestHttpOverSshChannel<{ status: string }>(
      channel,
      {
        method: "GET",
        path: "/health",
        token: "test-token",
      },
    );

    expect(result).toEqual({ status: "ok" });
  });

  test("reports HTTP errors with the response payload", async () => {
    const channel = new FakeSshChannel([
      httpResponse(
        "HTTP/1.1 401 Unauthorized",
        [],
        '{"error":"Invalid token"}',
      ),
    ]);

    await expect(
      requestHttpOverSshChannel(channel, {
        method: "GET",
        path: "/metrics",
        token: "wrong-token",
      }),
    ).rejects.toThrow(
      'Monitoring agent request failed (401): {"error":"Invalid token"}',
    );
  });

  test("rejects oversized responses before buffering them", async () => {
    const channel = new FakeSshChannel([
      Buffer.from(
        "HTTP/1.1 200 OK\r\nContent-Length: 2097153\r\nConnection: close\r\n\r\n",
      ),
    ]);

    await expect(
      requestHttpOverSshChannel(channel, {
        method: "GET",
        path: "/metrics",
        token: "test-token",
      }),
    ).rejects.toThrow("Monitoring agent response is too large");
  });

  test("times out when the agent does not respond", async () => {
    const channel = new FakeSshChannel();

    await expect(
      requestHttpOverSshChannel(channel, {
        method: "GET",
        path: "/health",
        token: "test-token",
        timeoutMs: 10,
      }),
    ).rejects.toThrow("Monitoring agent request timed out");
  });
});
