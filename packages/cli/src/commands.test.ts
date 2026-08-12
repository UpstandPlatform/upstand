import { describe, expect, test } from "bun:test";
import { browserCommand } from "./commands";

describe("browser command construction", () => {
  test("quotes Windows verification URLs with query parameters", () => {
    expect(
      browserCommand(
        "https://upstand.dev/login?cli=upstand&user_code=ABCD2",
        "win32",
      ),
    ).toEqual([
      "cmd",
      "/c",
      "start",
      "",
      '"https://upstand.dev/login?cli=upstand&user_code=ABCD2"',
    ]);
  });
});
