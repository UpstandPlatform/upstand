import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/cli.ts"],
  format: "esm",
  outDir: "./dist",
  clean: true,
  deps: {
    alwaysBundle: [/@upstand\/.*/],
    neverBundle: ["ssh2", "@opentelemetry/api"],
  },
  // ssh2 loads an optional native dependency at runtime. Keeping it external
  // lets Bun resolve the platform-specific binary instead of asking Rolldown to
  // bundle a .node artifact into the server output.
});
