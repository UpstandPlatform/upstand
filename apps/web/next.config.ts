import { env } from "@upstand/env/web";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Next's type generator requires the TypeScript CLI with TypeScript 7.
    useTypeScriptCli: true,
  } as NonNullable<NextConfig["experimental"]>,
  typescript: {
    ignoreBuildErrors:
      env.NODE_ENV !== "production" &&
      (env.SKIP_TYPECHECK === "1" || env.SKIP_TYPECHECK === "true"),
  },
  typedRoutes: true,
  // The compiler is valuable for production optimization.
  reactCompiler: env.NODE_ENV === "production",
  output: "standalone",
  devIndicators: false,
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "localhost:3000",
    "127.0.0.1:3000",
    "localhost:3001",
    "127.0.0.1:3001",
  ],
  // Turbopack must bundle Shiki from the workspace instead of trying to
  // resolve its generated external module name at runtime in Docker dev.
  transpilePackages: ["shiki"],
  async redirects() {
    return [
      {
        source: "/dashboard",
        destination: "/projects",
        permanent: false,
      },
      {
        source: "/audit-logs",
        destination: "/observation?tab=audits",
        permanent: false,
      },
      {
        source: "/monitoring",
        destination: "/observation?tab=monitoring",
        permanent: false,
      },
      {
        source: "/deployments",
        destination: "/observation?tab=deployments",
        permanent: false,
      },
      {
        source: "/requests",
        destination: "/observation?tab=requests",
        permanent: false,
      },
    ];
  },
  async headers() {
    // Self-hosted instances may be reached through an HTTP IP:port recovery
    // URL when their configured domain is unavailable. The browser must be
    // able to reach the sibling API and websocket ports in that mode; CORS,
    // authentication, and server-side origin checks remain the enforcement
    // boundaries for those requests.
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          ...(env.NODE_ENV === "production" &&
          env.NEXT_PUBLIC_SERVER_URL.startsWith("https://")
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
