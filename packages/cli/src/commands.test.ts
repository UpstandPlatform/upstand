import { describe, expect, test } from "bun:test";
import { browserCommand } from "./commands";

describe("browser command construction", () => {
  test("passes Windows verification URLs directly to Explorer", () => {
    expect(
      browserCommand(
        "https://upstand.dev/login?cli=upstand&user_code=ABCD2",
        "win32",
      ),
    ).toEqual([
      "explorer.exe",
      "https://upstand.dev/login?cli=upstand&user_code=ABCD2",
    ]);
  });
});
