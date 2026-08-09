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

  async deviceAuthorize() {
    return this.deviceRequest<{
      deviceCode: string;
      userCode: string;
      verificationUri: string;
      expiresIn: number;
      interval: number;
    }>("authorize", { clientId: "upstand-cli" });
  }

  async deviceToken(deviceCode: string) {
    return this.deviceRequest<{
      status:
        | "authorization_pending"
        | "access_denied"
        | "expired_token"
        | "approved";
      accessToken?: string;
      organizationId?: string;
      tokenType?: "Bearer";
    }>("token", { clientId: "upstand-cli", deviceCode });
  }

  async exportControlPlane(input: {
    includeSecrets: boolean;
    passphrase?: string;
  }): Promise<Response> {
    const response = await this.fetcher(
      new URL("/api/control-plane-transfer/export", this.options.apiUrl),
      {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(input),
      },
    );
    await this.assertSuccessful(response);
    return response;
  }

  async importControlPlane(input: {
    content: Blob;
    mode: "merge" | "replace";
    passphrase?: string;
    resumeSessionId?: string;
  }): Promise<ApiResponse<{ imported: number; conflicts: readonly string[] }>> {
    const headers = this.headers({
      "Content-Type": "application/vnd.upstand.transfer+ndjson",
      "X-Upstand-Transfer-Mode": input.mode,
    });
    if (input.passphrase) {
      headers.set("X-Upstand-Transfer-Passphrase", input.passphrase);
    }
    if (input.resumeSessionId) {
      headers.set("X-Upstand-Transfer-Session", input.resumeSessionId);
    }
    const response = await this.fetcher(
      new URL("/api/control-plane-transfer/import", this.options.apiUrl),
      { method: "POST", headers, body: input.content },
    );
    const body = await response.json().catch(() => undefined);
    if (!response.ok) throw this.apiError(response, body);
    return {
      data: body as { imported: number; conflicts: readonly string[] },
      response,
    };
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
    const headers = this.headers();
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
      throw this.apiError(response, body);
    }
    return { data: body as T, response };
  }

  private async deviceRequest<T>(
    action: "authorize" | "token",
    body: Record<string, unknown>,
  ) {
    const response = await this.fetcher(
      new URL(`/api/cli/device/${action}`, this.options.apiUrl),
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "@upstand/cli",
        },
        body: JSON.stringify(body),
      },
    );
    const payload = await response.json().catch(() => undefined);
    if (!response.ok && response.status !== 428) {
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : `Upstand CLI authentication failed with status ${response.status}`;
      throw new ApiError(message, response.status, payload);
    }
    return { data: payload as T, response };
  }

  private headers(initial?: Record<string, string>): Headers {
    const headers = new Headers(initial);
    headers.set("Accept", "application/json");
    headers.set("User-Agent", "@upstand/cli");
    if (this.options.token) {
      headers.set("Authorization", `Bearer ${this.options.token}`);
    }
    if (this.options.sessionCookie) {
      headers.set("Cookie", this.options.sessionCookie);
    }
    return headers;
  }

  private async assertSuccessful(response: Response): Promise<void> {
    if (response.ok) return;
    const body = await response.json().catch(() => undefined);
    throw this.apiError(response, body);
  }

  private apiError(response: Response, body: unknown): ApiError {
    const message =
      typeof body === "object" &&
      body !== null &&
      ("message" in body || "error" in body)
        ? String("message" in body ? body.message : body.error)
        : `Upstand API request failed with status ${response.status}`;
    return new ApiError(message, response.status, body);
  }
}
