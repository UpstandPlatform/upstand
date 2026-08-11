import { afterEach, describe, expect, test } from "bun:test";
import { renderMessage } from "./ui";

const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
});

describe("CLI human output", () => {
  test("writes persistent messages directly to terminal streams", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    process.stdout.write = ((chunk: string) => {
      stdout.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string) => {
      stderr.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    await renderMessage("help text");
    await renderMessage("error text", "error");

    expect(stdout).toEqual(["help text\n"]);
    expect(stderr).toEqual(["error text\n"]);
  });
});
