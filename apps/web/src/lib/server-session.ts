import { headers } from "next/headers";
import type { authClient } from "@/lib/auth-client";
import { getServerUrlFromHeaders } from "@/lib/server-url";

/**
 * Fetch the current session from the API while rendering a dashboard route.
 *
 * The dashboard and API are sibling hosts in self-hosted installs. A module
 * level Better Auth client cannot know the incoming dashboard host during SSR,
 * so it would otherwise fall back to the build-time placeholder/localhost and
 * incorrectly redirect authenticated users to /login.
 */
export async function getServerSession(): Promise<
  typeof authClient.$Infer.Session | null
> {
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie");
  const response = await fetch(
    new URL(
      "/api/auth/get-session",
      `${getServerUrlFromHeaders(requestHeaders)}/`,
    ),
    {
      headers: {
        ...(cookie ? { cookie } : {}),
        accept: "application/json",
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Session request failed with HTTP ${response.status}`);
  }

  return (await response.json()) as typeof authClient.$Infer.Session | null;
}
