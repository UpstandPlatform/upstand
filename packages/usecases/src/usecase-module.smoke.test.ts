import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Glob } from "bun";

const usecaseFiles = await Array.fromAsync(
  new Glob("packages/usecases/src/**/*.usecase.ts").scan({
    cwd: resolve(import.meta.dir, "../../.."),
    onlyFiles: true,
  }),
);

describe("use-case module smoke matrix", () => {
  test("discovers every use-case module", () => {
    expect(usecaseFiles.length).toBeGreaterThanOrEqual(100);
  });

  test("loads every use-case module without an import-time failure", async () => {
    for (const relativePath of usecaseFiles) {
      const absolutePath = resolve(import.meta.dir, "../../..", relativePath);
      const module = await import(pathToFileURL(absolutePath).href);
      expect(Object.keys(module).length, relativePath).toBeGreaterThan(0);
    }
  }, 10_000);
});
