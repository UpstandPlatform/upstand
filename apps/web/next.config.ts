import "@upstand/env/web";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors:
      process.env.SKIP_TYPECHECK === "1" ||
      process.env.SKIP_TYPECHECK === "true",
  },
  typedRoutes: true,
  // The compiler is valuable for production optimization.
  reactCompiler: process.env.NODE_ENV === "production",
  output: "standalone",
  devIndicators: false,
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
};

export default nextConfig;
