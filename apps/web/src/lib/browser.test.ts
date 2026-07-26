// @ts-nocheck
import { afterEach, describe, expect, test } from "bun:test";
import {
  validateArchiveDestination,
  validateArchiveFile,
} from "./archive-upload";
import { downloadText, normalizeDownloadFilename } from "./browser";

describe("browser helpers", () => {
  test("normalizes unsafe download filenames", () => {
    expect(normalizeDownloadFilename(" ../secret:report?.txt ")).toBe(
      "..-secret-report-.txt",
    );
    expect(normalizeDownloadFilename("...")).toBe("download");
  });

  test("cleans up temporary download URLs", () => {
    const clicked: { href: string; download: string; removed: boolean } = {
      href: "",
      download: "",
      removed: false,
    };
    const revoked: string[] = [];
    const originalDocument = globalThis.document;
    const originalUrl = globalThis.URL;
    globalThis.document = {
      body: { appendChild: () => undefined },
      createElement: () => ({
        ...clicked,
        click: () => undefined,
        remove: () => {
          clicked.removed = true;
        },
      }),
    } as unknown as Document;
    globalThis.URL = {
      createObjectURL: () => "blob:test",
      revokeObjectURL: (url: string) => revoked.push(url),
    } as unknown as typeof URL;

    downloadText("hello", "report.txt");

    expect(clicked.removed).toBe(true);
    expect(revoked).toEqual(["blob:test"]);
    globalThis.document = originalDocument;
    globalThis.URL = originalUrl;
  });

  test("validates archive type, size, and destination", () => {
    expect(
      validateArchiveFile(new File(["data"], "archive.zip"), {
        extensions: [".zip"],
      }),
    ).toBeNull();
    expect(
      validateArchiveFile(new File(["data"], "archive.zip"), {
        extensions: [".tar"],
      }),
    ).toContain("Supported archive types");
    expect(validateArchiveDestination("tmp")).toContain("absolute");
    expect(validateArchiveDestination("/tmp")).toBeNull();
  });
});

afterEach(() => {
  // Keep the test environment isolated when a helper test fails.
  delete globalThis.document;
});
