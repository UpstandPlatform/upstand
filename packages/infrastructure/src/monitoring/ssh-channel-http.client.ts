import type { Duplex } from "node:stream";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;
const CRLF = Buffer.from("\r\n");
const HEADER_SEPARATOR = Buffer.from("\r\n\r\n");

export type SshChannelHttpRequest = {
  method: "GET" | "POST";
  path: string;
  token: string;
  body?: Record<string, unknown>;
  timeoutMs?: number;
};

type ParsedResponse = {
  statusCode: number;
  body: Buffer;
};

/**
 * Sends one HTTP request over an already-established ssh2 forwarding channel.
 *
 * The channel is a connected byte stream, not a TCP listener. Using
 * node:http.request() with createConnection is not reliable under Bun's Node
 * compatibility layer because it can attempt a new local TCP connection
 * instead of writing to the supplied ssh2 channel.
 */
export async function requestHttpOverSshChannel<T>(
  channel: Duplex,
  options: SshChannelHttpRequest,
): Promise<T> {
  assertSafeRequest(options);
  const response = await exchangeHttpOverSshChannel(channel, options);
  const payload = response.body.toString("utf8");

  if (response.statusCode >= 400) {
    throw new Error(
      `Monitoring agent request failed (${response.statusCode}): ${payload}`,
    );
  }

  try {
    return JSON.parse(payload) as T;
  } catch (error) {
    throw new Error("Monitoring agent returned invalid JSON", { cause: error });
  }
}

function assertSafeRequest(options: SshChannelHttpRequest): void {
  if (!options.path.startsWith("/") || /[\r\n]/.test(options.path)) {
    throw new Error("Monitoring agent request path is invalid");
  }
  if (/[\r\n]/.test(options.token)) {
    throw new Error("Monitoring agent token is invalid");
  }
}

async function exchangeHttpOverSshChannel(
  channel: Duplex,
  options: SshChannelHttpRequest,
): Promise<ParsedResponse> {
  const body = options.body ? JSON.stringify(options.body) : undefined;
  const request = Buffer.from(
    [
      `${options.method} ${options.path} HTTP/1.1`,
      "Host: 127.0.0.1:3001",
      "Accept: application/json",
      `Authorization: Bearer ${options.token}`,
      ...(body
        ? [
            "Content-Type: application/json",
            `Content-Length: ${Buffer.byteLength(body)}`,
          ]
        : []),
      "Connection: close",
      "",
      "",
    ].join("\r\n") + (body ?? ""),
  );

  return new Promise<ParsedResponse>((resolve, reject) => {
    let settled = false;
    let headerBuffer = Buffer.alloc(0);
    let responseBody = Buffer.alloc(0);
    let statusCode: number | undefined;
    let expectedBodyLength: number | undefined;
    let chunked = false;
    let chunkCursor = 0;
    const chunkParts: Buffer[] = [];
    let chunkedBodyLength = 0;

    const timer = setTimeout(
      () => fail(new Error("Monitoring agent request timed out")),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    const cleanup = () => {
      clearTimeout(timer);
      channel.removeListener("data", onData);
      channel.removeListener("error", onError);
      channel.removeListener("end", onClose);
      channel.removeListener("close", onClose);
    };

    const succeed = (bodyBytes: Buffer) => {
      if (settled || statusCode === undefined) return;
      settled = true;
      cleanup();
      resolve({ statusCode, body: bodyBytes });
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
      channel.destroy();
    };

    const appendBody = (chunk: Buffer) => {
      responseBody = Buffer.concat([responseBody, chunk]);
      if (responseBody.length > MAX_RESPONSE_BYTES) {
        fail(new Error("Monitoring agent response is too large"));
      }
    };

    const parseChunkedBody = () => {
      while (true) {
        const sizeEnd = responseBody.indexOf(CRLF, chunkCursor);
        if (sizeEnd < 0) return;

        const sizeLine = responseBody
          .subarray(chunkCursor, sizeEnd)
          .toString("ascii");
        const sizeText = sizeLine.split(";", 1)[0]?.trim();
        if (!sizeText) {
          fail(new Error("Monitoring agent returned invalid chunked data"));
          return;
        }
        const chunkSize = Number.parseInt(sizeText, 16);
        if (!Number.isFinite(chunkSize) || chunkSize < 0) {
          fail(new Error("Monitoring agent returned invalid chunked data"));
          return;
        }

        const chunkStart = sizeEnd + CRLF.length;
        const chunkEnd = chunkStart + chunkSize;
        if (chunkSize === 0) {
          if (
            responseBody.length >= chunkStart + CRLF.length &&
            responseBody
              .subarray(chunkStart, chunkStart + CRLF.length)
              .equals(CRLF)
          ) {
            succeed(Buffer.concat(chunkParts, chunkedBodyLength));
            return;
          }
          if (responseBody.indexOf(HEADER_SEPARATOR, chunkStart) < 0) return;
          succeed(Buffer.concat(chunkParts, chunkedBodyLength));
          return;
        }

        if (responseBody.length < chunkEnd + CRLF.length) return;
        if (
          !responseBody.subarray(chunkEnd, chunkEnd + CRLF.length).equals(CRLF)
        ) {
          fail(new Error("Monitoring agent returned invalid chunked data"));
          return;
        }

        chunkedBodyLength += chunkSize;
        if (chunkedBodyLength > MAX_RESPONSE_BYTES) {
          fail(new Error("Monitoring agent response is too large"));
          return;
        }
        chunkParts.push(responseBody.subarray(chunkStart, chunkEnd));
        chunkCursor = chunkEnd + CRLF.length;
      }
    };

    const parseHeaders = () => {
      const headerEnd = headerBuffer.indexOf(HEADER_SEPARATOR);
      if (headerEnd < 0) {
        if (headerBuffer.length > MAX_HEADER_BYTES) {
          fail(new Error("Monitoring agent response headers are too large"));
        }
        return;
      }

      const headerText = headerBuffer
        .subarray(0, headerEnd)
        .toString("latin1")
        .split("\r\n");
      const statusMatch = /^HTTP\/\d(?:\.\d)?\s+(\d{3})(?:\s|$)/.exec(
        headerText.shift() ?? "",
      );
      const statusText = statusMatch?.[1];
      if (!statusText) {
        fail(new Error("Monitoring agent returned an invalid HTTP response"));
        return;
      }
      statusCode = Number.parseInt(statusText, 10);

      const responseHeaders = new Map<string, string>();
      for (const line of headerText) {
        const separator = line.indexOf(":");
        if (separator <= 0) {
          fail(new Error("Monitoring agent returned invalid HTTP headers"));
          return;
        }
        const name = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim();
        responseHeaders.set(
          name,
          responseHeaders.has(name)
            ? `${responseHeaders.get(name)}, ${value}`
            : value,
        );
      }

      const contentLength = responseHeaders.get("content-length");
      if (contentLength !== undefined) {
        expectedBodyLength = Number.parseInt(contentLength, 10);
        if (
          !Number.isSafeInteger(expectedBodyLength) ||
          expectedBodyLength < 0
        ) {
          fail(new Error("Monitoring agent returned invalid content length"));
          return;
        }
        if (expectedBodyLength > MAX_RESPONSE_BYTES) {
          fail(new Error("Monitoring agent response is too large"));
          return;
        }
      }
      chunked = /(?:^|\s|,)chunked(?:\s|,|$)/i.test(
        responseHeaders.get("transfer-encoding") ?? "",
      );

      const bodyStart = headerEnd + HEADER_SEPARATOR.length;
      responseBody = headerBuffer.subarray(bodyStart);
      headerBuffer = Buffer.alloc(0);
      if (responseBody.length > MAX_RESPONSE_BYTES + MAX_HEADER_BYTES) {
        fail(new Error("Monitoring agent response is too large"));
        return;
      }

      if (chunked) {
        parseChunkedBody();
      } else if (
        expectedBodyLength !== undefined &&
        responseBody.length >= expectedBodyLength
      ) {
        succeed(responseBody.subarray(0, expectedBodyLength));
      } else if (
        expectedBodyLength === undefined &&
        responseBody.length > MAX_RESPONSE_BYTES
      ) {
        fail(new Error("Monitoring agent response is too large"));
      }
    };

    function onData(chunk: Buffer | string) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (settled) return;
      if (statusCode === undefined) {
        headerBuffer = Buffer.concat([headerBuffer, bytes]);
        parseHeaders();
        return;
      }
      if (chunked) {
        responseBody = Buffer.concat([responseBody, bytes]);
        if (responseBody.length > MAX_RESPONSE_BYTES + MAX_HEADER_BYTES) {
          fail(new Error("Monitoring agent response is too large"));
          return;
        }
        parseChunkedBody();
        return;
      }
      appendBody(bytes);
      if (
        expectedBodyLength !== undefined &&
        responseBody.length >= expectedBodyLength
      ) {
        succeed(responseBody.subarray(0, expectedBodyLength));
      }
    }

    function onError(error: Error) {
      fail(error);
    }

    function onClose() {
      if (settled || statusCode === undefined) return;
      if (chunked) {
        fail(
          new Error("Monitoring agent closed an incomplete chunked response"),
        );
      } else if (
        expectedBodyLength === undefined ||
        responseBody.length >= expectedBodyLength
      ) {
        succeed(
          expectedBodyLength === undefined
            ? responseBody
            : responseBody.subarray(0, expectedBodyLength),
        );
      } else {
        fail(new Error("Monitoring agent closed an incomplete response"));
      }
    }

    channel.on("data", onData);
    channel.once("error", onError);
    channel.once("end", onClose);
    channel.once("close", onClose);
    channel.end(request);
  });
}
