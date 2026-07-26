import "@upstand/env/web";
import crypto from "node:crypto";
import type { NextConfig } from "next";

class SafeSha256 {
  private hash = crypto.createHash("sha256");

  update(
    data: string | NodeJS.ArrayBufferView<ArrayBufferLike>,
    encoding?: BufferEncoding,
  ): this {
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
  reactCompiler: true,
  output: "standalone",
  devIndicators: false,
  webpack: (config) => {
    config.output.hashFunction = SafeSha256;
    return config;
  },
};

export default nextConfig;
