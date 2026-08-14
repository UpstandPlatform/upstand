import { describe, expect, test } from "bun:test";
import { browserCommand } from "./commands";

describe("browser command construction", () => {
  test("opens Windows verification URLs through the default browser", () => {
    expect(
      browserCommand(
        "https://upstand.dev/login?cli=upstand-cli&user_code=ABCD2",
        "win32",
      ),
    ).toEqual([
      "cmd.exe",
      "/d",
      "/s",
      "/c",
      'start "" "https://upstand.dev/login?cli=upstand-cli&user_code=ABCD2"',
    ]);
  });
});
