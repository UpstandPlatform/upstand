import { z } from "zod";

export const MAX_CHAT_REQUEST_BYTES = 256 * 1024;
export const MAX_CHAT_MESSAGES = 50;

const chatRequestSchema = z.object({
  messages: z.array(z.unknown()).min(1).max(MAX_CHAT_MESSAGES),
});

export type BoundedRequestBody =
  | { body: string; tooLarge: false }
  | { body: null; tooLarge: true };

/**
 * Read a request body without allowing chunked requests to bypass the size
 * limit before JSON parsing allocates the complete payload.
 */
export async function readBoundedRequestBody(
  request: Request,
  maxBytes = MAX_CHAT_REQUEST_BYTES,
): Promise<BoundedRequestBody> {
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { body: null, tooLarge: true };
  }

  if (!request.body) return { body: "", tooLarge: false };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { body: null, tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body: new TextDecoder().decode(bytes), tooLarge: false };
}

export function parseChatRequest(
  rawBody: string,
): { messages: unknown[] } | { error: "invalid_json" | "invalid_shape" } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { error: "invalid_json" };
  }

  const result = chatRequestSchema.safeParse(parsed);
  return result.success ? result.data : { error: "invalid_shape" };
}
