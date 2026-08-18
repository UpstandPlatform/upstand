import { describe, expect, test } from "bun:test";
import {
  cliAuthorizationPath,
  cliUserCodeFromSearchParams,
} from "./cli-authorization";

describe("CLI browser authorization contract", () => {
  test("recognizes the server-issued client id", () => {
    expect(
      cliUserCodeFromSearchParams(
        new URLSearchParams("cli=upstand-cli&user_code=QBFFW"),
      ),
    ).toBe("QBFFW");
  });

  test("ignores unrelated login links", () => {
    expect(
      cliUserCodeFromSearchParams(
        new URLSearchParams("cli=upstand&user_code=QBFFW"),
      ),
    ).toBeNull();
  });

  test("builds a login return path with an encoded one-time code", () => {
    expect(cliAuthorizationPath("AB CD")).toBe(
      "/login?cli=upstand-cli&user_code=AB%20CD",
    );
  });
});
