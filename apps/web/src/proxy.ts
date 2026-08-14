import { evlogMiddleware } from "evlog/next";
import { type NextRequest, NextResponse } from "next/server";
import { getServerUrlFromHeaders } from "@/lib/server-url";

const logProxy = evlogMiddleware();

const DASHBOARD_PATHS = [
  "/dashboard",
  "/projects",
  "/templates",
  "/topology",
  "/remote-servers",
  "/ssh-keys",
  "/docker-swarm",
  "/docker",
  "/docker-registry",
  "/web-server",
  "/certificates",
  "/git-providers",
  "/s3-destinations",
  "/secret-providers",
  "/settings",
  "/observation",
  "/notifications",
  "/tags",
  "/2fa-verify",
] as const;

function isDashboardPath(pathname: string): boolean {
  return DASHBOARD_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

async function dashboardSessionState(
  request: NextRequest,
): Promise<"authenticated" | "anonymous" | "unavailable"> {
  const sessionUrl = new URL(
    "/api/auth/get-session",
    `${getServerUrlFromHeaders(request.headers)}/`,
  );

  try {
    const response = await fetch(sessionUrl, {
      headers: {
        ...(request.headers.get("cookie")
          ? { cookie: request.headers.get("cookie") ?? "" }
          : {}),
        accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    if (response.status === 401 || response.status === 403) return "anonymous";
    if (!response.ok) return "unavailable";

    const session = (await response.json()) as {
      user?: unknown;
    } | null;
    return session?.user ? "authenticated" : "anonymous";
  } catch {
    return "unavailable";
  }
}

export async function proxy(request: NextRequest) {
  const loggedResponse = await logProxy(request);
  if (!isDashboardPath(request.nextUrl.pathname)) return loggedResponse;

  const sessionState = await dashboardSessionState(request);
  if (sessionState !== "anonymous") return loggedResponse;

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "return_to",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/api/:path*",
    "/dashboard/:path*",
    "/projects/:path*",
    "/templates/:path*",
    "/topology/:path*",
    "/remote-servers/:path*",
    "/ssh-keys/:path*",
    "/docker-swarm/:path*",
    "/docker/:path*",
    "/docker-registry/:path*",
    "/web-server/:path*",
    "/certificates/:path*",
    "/git-providers/:path*",
    "/s3-destinations/:path*",
    "/secret-providers/:path*",
    "/settings/:path*",
    "/observation/:path*",
    "/notifications/:path*",
    "/tags/:path*",
    "/2fa-verify",
  ],
};
