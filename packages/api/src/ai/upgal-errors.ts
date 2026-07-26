export type UpGalErrorCode =
  | "configuration"
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "validation"
  | "permission"
  | "tool"
  | "provider"
  | "internal";

export type UpGalErrorSource = "provider" | "web_search";

export class UpGalError extends Error {
  constructor(
    public readonly code: UpGalErrorCode,
    message: string,
    public readonly source?: UpGalErrorSource,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "UpGalError";
  }
}

export type UpGalErrorInfo = {
  code: UpGalErrorCode;
  status: 400 | 401 | 403 | 408 | 429 | 500 | 502 | 503;
  retryable: boolean;
  userMessage: string;
};

function infoForCode(
  code: UpGalErrorCode,
  source?: UpGalErrorSource,
): UpGalErrorInfo {
  switch (code) {
    case "configuration":
      return {
        code,
        status: 503,
        retryable: false,
        userMessage:
          source === "web_search"
            ? "Web search is not configured on this Upstand server. Set UPGAL_WEB_SEARCH_API_KEY and retry."
            : "UpGal needs a configured AI provider. Open Settings → UpGal Settings and configure one before retrying.",
      };
    case "authentication":
      return {
        code,
        status: 401,
        retryable: false,
        userMessage:
          "UpGal could not authenticate with the configured AI provider. Check the API key in Settings → UpGal Settings.",
      };
    case "rate_limit":
      return {
        code,
        status: 429,
        retryable: true,
        userMessage:
          "The AI provider is rate-limiting this request. Wait a moment and try again.",
      };
    case "timeout":
      return {
        code,
        status: 408,
        retryable: true,
        userMessage:
          "UpGal took too long to receive a response. The completed inspection results are preserved; retry to continue.",
      };
    case "permission":
      return {
        code,
        status: 403,
        retryable: false,
        userMessage: "You do not have permission to use this UpGal capability.",
      };
    case "validation":
      return {
        code,
        status: 400,
        retryable: false,
        userMessage:
          "UpGal could not validate that request. Check the selected resource and try again.",
      };
    case "tool":
    case "provider":
    case "internal":
      return {
        code,
        status: code === "internal" ? 500 : 502,
        retryable: code !== "internal",
        userMessage:
          "UpGal could not complete this response. Completed tool results remain available above; retry to continue.",
      };
  }
}

function providerStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const details = error as { statusCode?: unknown; status?: unknown };
  const status = details.statusCode ?? details.status;
  return typeof status === "number" ? status : null;
}

export function classifyUpGalError(error: unknown): UpGalErrorInfo {
  if (error instanceof UpGalError) return infoForCode(error.code, error.source);

  if (error instanceof DOMException && error.name === "AbortError") {
    return infoForCode("timeout");
  }

  if (
    typeof error === "object" &&
    error !== null &&
    ((error as { name?: string }).name === "ZodError" ||
      "issues" in (error as Record<string, unknown>))
  ) {
    const message =
      error instanceof Error ? error.message : "Invalid tool parameters";
    return {
      code: "validation",
      status: 400,
      retryable: false,
      userMessage: `Invalid tool parameters: ${message}`,
    };
  }

  const status = providerStatus(error);
  if (status === 401) return infoForCode("authentication");
  if (status === 403) return infoForCode("permission");
  if (status === 429) return infoForCode("rate_limit");
  if (status !== null && status >= 400 && status < 500) {
    return infoForCode("validation");
  }

  return infoForCode("provider");
}

export function upGalErrorMessage(error: unknown) {
  return classifyUpGalError(error).userMessage;
}
