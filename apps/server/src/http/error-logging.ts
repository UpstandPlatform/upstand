import type { RequestLogger } from "evlog";

export function logRequestError(
  logger: Pick<RequestLogger, "error">,
  error: unknown,
  context: Record<string, unknown>,
): void {
  logger.error(error instanceof Error ? error : String(error), context);
}
