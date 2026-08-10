import { readResponseBodyLimited } from "@upstand/platform/network/response-body";
import { assertSafeProviderUrlAsync } from "./provider-config";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
type AddressResolver = (
  hostname: string,
) => Promise<Array<{ address: string }>>;

async function safeInput(
  input: string | URL | Request,
  resolveHost?: AddressResolver,
): Promise<string | URL | Request> {
  if (input instanceof Request) {
    await assertSafeProviderUrlAsync(input.url, resolveHost);
  } else {
    await assertSafeProviderUrlAsync(String(input), resolveHost);
  }
  return input;
}

export async function requestJson<T>(
  input: string | URL | Request,
  init: RequestInit | undefined,
  createError: (response: Response) => string | Promise<string>,
  resolveHost?: AddressResolver,
): Promise<T> {
  const result = await requestJsonWithResponse<T>(
    input,
    init,
    createError,
    resolveHost,
  );
  return result.data;
}

export async function requestJsonWithResponse<T>(
  input: string | URL | Request,
  init: RequestInit | undefined,
  createError: (response: Response) => string | Promise<string>,
  resolveHost?: AddressResolver,
): Promise<{ data: T; response: Response }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (init?.signal) {
    init.signal.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }
  const response = await fetch(await safeInput(input, resolveHost), {
    ...init,
    signal: controller.signal,
    redirect: "error",
  }).finally(() => clearTimeout(timeout));

  const body = await readResponseBodyLimited(response, MAX_RESPONSE_BYTES);
  if (!response.ok) {
    const boundedResponse = new Response(new TextDecoder().decode(body), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    throw new Error(await createError(boundedResponse));
  }
  return { data: JSON.parse(new TextDecoder().decode(body)) as T, response };
}
