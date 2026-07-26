import { assertSafeProviderUrl } from "./provider-config";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function safeInput(input: string | URL | Request): string | URL | Request {
  if (input instanceof Request) {
    assertSafeProviderUrl(input.url);
  } else {
    assertSafeProviderUrl(String(input));
  }
  return input;
}

export async function requestJson<T>(
  input: string | URL | Request,
  init: RequestInit | undefined,
  createError: (response: Response) => string | Promise<string>,
): Promise<T> {
  const result = await requestJsonWithResponse<T>(input, init, createError);
  return result.data;
}

export async function requestJsonWithResponse<T>(
  input: string | URL | Request,
  init: RequestInit | undefined,
  createError: (response: Response) => string | Promise<string>,
): Promise<{ data: T; response: Response }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (init?.signal) {
    init.signal.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }
  const response = await fetch(safeInput(input), {
    ...init,
    signal: controller.signal,
    redirect: "error",
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(await createError(response));
  }

  const body = await response.arrayBuffer();
  if (body.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("Git provider response is too large");
  }
  return { data: JSON.parse(new TextDecoder().decode(body)) as T, response };
}
