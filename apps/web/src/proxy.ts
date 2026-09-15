import { type NextRequest, NextResponse } from "next/server";
import { getServerUrlFromHeaders } from "@/lib/server-url";

function createCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

function contentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https://github.com",
    "connect-src 'self' http: https: ws: wss:",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline' https:",
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""}`,
  ].join("; ");
}

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
  const nonce = createCspNonce();
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-evlog-start", String(Date.now()));
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  response.headers.set("Content-Security-Policy", csp);
  if (!isDashboardPath(request.nextUrl.pathname)) return response;

  const sessionState = await dashboardSessionState(request);
  if (sessionState !== "anonymous") return response;

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "return_to",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
