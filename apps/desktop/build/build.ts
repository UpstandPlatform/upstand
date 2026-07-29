import { cp, mkdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

const appRoot = resolve(import.meta.dirname, "..");
const output = resolve(appRoot, "dist");

await rm(output, { force: true, recursive: true });
await mkdir(output, { recursive: true });

for (const [entrypoint, outfile] of [
  ["src/main/index.ts", "dist/main.cjs"],
  ["src/preload/index.ts", "dist/preload.cjs"],
] as const) {
  const temporaryOutput = resolve(
    output,
    ".bundle",
    entrypoint.replaceAll("/", "-"),
  );
  await mkdir(temporaryOutput, { recursive: true });
  const result = await Bun.build({
    entrypoints: [resolve(appRoot, entrypoint)],
    external: ["electron"],
    format: "cjs",
    minify: false,
    outdir: temporaryOutput,
    target: "node",
  });
  if (!result.success) {
    throw new Error(
      result.logs.map((log: { message: string }) => log.message).join("\n"),
    );
  }
  const generated = result.outputs[0];
  if (!generated) throw new Error(`No bundle was produced for ${entrypoint}`);
  await rename(generated.path, resolve(appRoot, outfile));
}
await rm(resolve(output, ".bundle"), { force: true, recursive: true });

await cp(resolve(appRoot, "src/renderer"), resolve(output, "renderer"), {
  recursive: true,
});
