import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");
const main = read("../src/main/index.ts");
const preload = read("../src/preload/index.ts");
const channels = (source: string, expression: RegExp) =>
  [...source.matchAll(expression)].map((match) => match[1]);

describe("desktop IPC contract", () => {
  test("every preload invocation has a main-process handler", () => {
    const invoked = channels(preload, /ipcRenderer\.invoke\("([^"]+)"/g);
    const handled = new Set(channels(main, /ipcMain\.handle\("([^"]+)"/g));
    expect(invoked.filter((channel) => !handled.has(channel))).toEqual([]);
  });
});
