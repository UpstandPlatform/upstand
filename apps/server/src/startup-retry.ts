export interface StartupRetryOptions {
  attempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (input: {
    attempt: number;
    delayMs: number;
    error: unknown;
  }) => void | Promise<void>;
}

const DEFAULT_ATTEMPTS = 12;
const DEFAULT_INITIAL_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 10_000;

export async function retryStartupOperation<T>(
  operation: () => Promise<T>,
  options: StartupRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(
    1,
    Math.floor(options.attempts ?? DEFAULT_ATTEMPTS),
  );
  const initialDelayMs = Math.max(
    0,
    Math.floor(options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS),
  );
  const maxDelayMs = Math.max(
    initialDelayMs,
    Math.floor(options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS),
  );
  const sleep = options.sleep ?? ((delayMs: number) => Bun.sleep(delayMs));

  let delayMs = initialDelayMs;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;
      if (attempt === attempts) throw error;

      await options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
      delayMs = Math.min(maxDelayMs, Math.max(1, delayMs * 2));
    }
  }

  throw lastError;
}
