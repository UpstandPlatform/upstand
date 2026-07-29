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
      process.env.SKIP_TYPECHECK === "1" ||
      process.env.SKIP_TYPECHECK === "true",
  },
  reactStrictMode: true,
  output: "standalone",
};

export default withMDX(config);
