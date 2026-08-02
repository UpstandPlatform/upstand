import { env } from "@upstand/env/web";
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  experimental: {
    // Next's type generator requires the TypeScript CLI with TypeScript 7.
    useTypeScriptCli: true,
  },
  typescript: {
    ignoreBuildErrors:
      env.NODE_ENV !== "production" &&
      (env.SKIP_TYPECHECK === "1" || env.SKIP_TYPECHECK === "true"),
  },
  reactStrictMode: true,
  output: "standalone",
};

export default withMDX(config);
