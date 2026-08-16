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
    const isDev = env.NODE_ENV !== "production";
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";
    const connectSrc = isDev
      ? "connect-src 'self' http: https: ws: wss:"
      : "connect-src 'self' https: wss:";

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
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://github.com; ${connectSrc}; img-src 'self' data: blob: https:; font-src 'self' data: https:; style-src 'self' 'unsafe-inline' https:; ${scriptSrc}`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
