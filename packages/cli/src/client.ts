import type { ApiResponse, GlobalOptions } from "./types";

export type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function scalar(value: unknown): string | undefined {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? String(value)
    : undefined;
}

export class UpstandClient {
  constructor(
    private readonly options: GlobalOptions,
    private readonly fetcher: Fetcher = globalThis.fetch as Fetcher,
  ) {}

  async query<T>(
    procedure: string,
    input: Record<string, unknown> = {},
  ): Promise<ApiResponse<T>> {
    return this.request<T>("GET", procedure, input);
  }

  async mutate<T>(
    procedure: string,
    input: Record<string, unknown> = {},
  ): Promise<ApiResponse<T>> {
    return this.request<T>("POST", procedure, input);
  }

  private async request<T>(
    method: "GET" | "POST",
    procedure: string,
    input: Record<string, unknown>,
  ): Promise<ApiResponse<T>> {
    const normalized = procedure.trim().replace(/^\/+|\/+$/g, "");
    if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(normalized)) {
      throw new Error(
        `Invalid procedure '${procedure}'. Expected namespace.action.`,
      );
    }
    const url = new URL(
      `/api/${normalized.replace(".", "/")}`,
      this.options.apiUrl,
    );
    const headers = new Headers({
      Accept: "application/json",
      "User-Agent": "@upstand/cli",
    });
    if (this.options.token)
      headers.set("Authorization", `Bearer ${this.options.token}`);
    if (method === "GET") {
      for (const [key, value] of Object.entries(input)) {
        const item = scalar(value);
        if (item !== undefined) url.searchParams.set(key, item);
      }
    } else {
      headers.set("Content-Type", "application/json");
    }
    const response = await this.fetcher(url, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(input) : undefined,
    });
    const body = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message =
        typeof body === "object" &&
        body !== null &&
        "message" in body &&
        typeof body.message === "string"
          ? body.message
          : `Upstand API request failed with status ${response.status}`;
      throw new ApiError(message, response.status, body);
    }
    return { data: body as T, response };
  }
}
