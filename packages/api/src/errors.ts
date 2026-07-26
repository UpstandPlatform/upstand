import { TRPCError } from "@trpc/server";
import { DomainError, OperationalError } from "@upstand/domain";
import { log } from "evlog";
import type { RequestLog } from "./context";

type ErrorLogger = Pick<RequestLog, "error">;

const defaultErrorLogger: ErrorLogger = {
  error(error) {
    log.error(
      error instanceof Error ? error.message : String(error),
      "Unexpected system error in router",
    );
  },
};

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function handleUseCaseError(
  error: unknown,
  logger: ErrorLogger = defaultErrorLogger,
): never {
  if (error instanceof TRPCError) throw error;

  if (error instanceof DomainError) {
    let trpcCode:
      | "CONFLICT"
      | "NOT_FOUND"
      | "BAD_REQUEST"
      | "UNAUTHORIZED"
      | "FORBIDDEN" = "BAD_REQUEST";

    switch (error.code) {
      case "CONFLICT":
        trpcCode = "CONFLICT";
        break;
      case "ENTITY_NOT_FOUND":
        trpcCode = "NOT_FOUND";
        break;
      case "VALIDATION_ERROR":
        trpcCode = "BAD_REQUEST";
        break;
      case "UNAUTHORIZED":
        trpcCode = "UNAUTHORIZED";
        break;
      case "FORBIDDEN":
        trpcCode = "FORBIDDEN";
        break;
    }

    throw new TRPCError({
      code: trpcCode,
      message: error.message,
      cause: error,
    });
  }

  if (error instanceof OperationalError) {
    const trpcCode =
      error.code === "AUTHENTICATION"
        ? "UNAUTHORIZED"
        : error.code === "PERMISSION"
          ? "FORBIDDEN"
          : error.code === "RATE_LIMIT"
            ? "TOO_MANY_REQUESTS"
            : error.code === "TIMEOUT"
              ? "TIMEOUT"
              : "BAD_REQUEST";
    throw new TRPCError({
      code: trpcCode,
      message: error.message,
      cause: error,
    });
  }

  // Clean Architecture: Log raw internal errors for server troubleshooting
  // but mask details to avoid leaking database/system internals to client
  logger.error(error instanceof Error ? error.message : String(error), {
    message: "Unexpected system error in router",
  });

  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "An unexpected server error occurred.",
  });
}
