import { describe, expect, test } from "bun:test";
import { promptText } from "./prompt";

describe("OpenTUI prompts", () => {
  test("fail clearly instead of blocking in a non-interactive process", async () => {
    await expect(promptText("Organization ID")).rejects.toThrow(
      "Provide it as an option or run the command in an interactive terminal",
    );
  });
});
