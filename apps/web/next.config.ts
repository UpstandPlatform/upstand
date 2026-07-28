import "@upstand/env/web";
import crypto from "node:crypto";
import type { NextConfig } from "next";

class SafeSha256 {
  private hash = crypto.createHash("sha256");

  update(
    data?: string | NodeJS.ArrayBufferView<ArrayBufferLike>,
    encoding?: BufferEncoding,
  ): this {
    if (data === undefined) return this;
    if (typeof data === "string" && encoding !== undefined) {
      this.hash.update(data, encoding);
    } else {
      this.hash.update(data);
    }
    return this;
  }

  digest(encoding?: BufferEncoding): string | Buffer {
    return encoding === undefined
      ? this.hash.digest()
      : this.hash.digest(encoding);
  }
}

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors:
      process.env.SKIP_TYPECHECK === "1" ||
      process.env.SKIP_TYPECHECK === "true",
  },
  typedRoutes: true,
  // The compiler is valuable for production optimization but adds substantial
  // cold-start cost to the Webpack development graph.
  reactCompiler: process.env.NODE_ENV === "production",
  output: "standalone",
  devIndicators: false,
  // Keep a bounded warm route set in development. A short eviction window
  // forces this large dashboard graph to recompile on every navigation.
  onDemandEntries:
    process.env.NODE_ENV === "development"
      ? {
          maxInactiveAge: 5 * 60 * 1000,
          pagesBufferLength: 8,
        }
      : undefined,
  // Turbopack must bundle Shiki from the workspace instead of trying to
  // resolve its generated external module name at runtime in Docker dev.
  transpilePackages: ["shiki"],
  experimental: {
    // Keep local Webpack compilation from retaining unnecessary intermediate
    // module state in this large workspace graph.
    webpackMemoryOptimizations: true,
  },
  webpack: (config) => {
    config.output.hashFunction = SafeSha256;
    return config;
  },
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
