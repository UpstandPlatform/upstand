import { headers } from "next/headers";
import type { authClient } from "@/lib/auth-client";
import { getServerUrlFromHeaders } from "@/lib/server-url";

const SESSION_RETRY_DELAYS_MS = [0, 150, 500] as const;

type ServerSession = typeof authClient.$Infer.Session;
type SessionFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function isRetryableSessionStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Resolve a session without allowing a transient control-plane outage to
 * escape into a Next.js Server Component render.
 *
 * A 401/403 is an explicit anonymous session.  Transport failures and
 * retryable HTTP statuses are temporary availability failures, so retry them
 * briefly and then return null; the dashboard's normal session guard can show
 * its retry state or redirect instead of rendering Next's generic error page.
 */
export async function fetchServerSession(
  requestHeaders: Headers,
  fetchImpl: SessionFetch = fetch,
): Promise<ServerSession | null> {
  const cookie = requestHeaders.get("cookie");
  const sessionUrl = new URL(
    "/api/auth/get-session",
    `${getServerUrlFromHeaders(requestHeaders)}/`,
  );

  for (const [attempt, delayMs] of SESSION_RETRY_DELAYS_MS.entries()) {
    if (delayMs > 0) await wait(delayMs);

    try {
      const response = await fetchImpl(sessionUrl, {
        headers: {
          ...(cookie ? { cookie } : {}),
          accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        return (await response.json()) as ServerSession | null;
      }

      if (!isRetryableSessionStatus(response.status)) return null;
      if (attempt === SESSION_RETRY_DELAYS_MS.length - 1) return null;
    } catch {
      if (attempt === SESSION_RETRY_DELAYS_MS.length - 1) return null;
    }
  }

  return null;
}

/**
 * Fetch the current session from the API while rendering a dashboard route.
 *
 * The dashboard and API are sibling hosts in self-hosted installs. A module
 * level Better Auth client cannot know the incoming dashboard host during SSR,
 * so it would otherwise fall back to the build-time placeholder/localhost and
 * incorrectly redirect authenticated users to /login.
 */
export async function getServerSession(): Promise<ServerSession | null> {
  const requestHeaders = await headers();
  return fetchServerSession(requestHeaders);
}
