import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  typescript: {
    ignoreBuildErrors:
      process.env.SKIP_TYPECHECK === "1" ||
      process.env.SKIP_TYPECHECK === "true",
  },
  reactStrictMode: true,
  output: "standalone",
};

export default withMDX(config);
