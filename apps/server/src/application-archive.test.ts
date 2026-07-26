import { describe, expect, test } from "bun:test";
import {
  ApplicationArchiveValidationError,
  validateApplicationArchiveListings,
} from "./application-archive";

const archiveNames = "project/\nproject/index.js\n";
const archiveDetails =
  "drwxr-xr-x user/group 0 2026-07-15 12:00 project/\n-rw-r--r-- user/group 12 2026-07-15 12:00 project/index.js\n";

describe("application archive validation", () => {
  test("accepts regular files and directories within the archive root", () => {
    expect(
      validateApplicationArchiveListings(100, archiveNames, archiveDetails),
    ).toEqual({ entryCount: 2, totalSize: 12 });
  });

  test("accepts BSD tar metadata", () => {
    expect(
      validateApplicationArchiveListings(
        100,
        "README.md\n",
        "-rw-rw-rw-  0 0      0        7029 Jul 15 13:37 README.md\n",
      ),
    ).toEqual({ entryCount: 1, totalSize: 7029 });
  });

  test.each(["../outside.txt", "/outside.txt", "C:/outside.txt"])(
    "rejects an absolute or traversing path: %s",
    (entry) => {
      expect(() =>
        validateApplicationArchiveListings(
          100,
          `${entry}\n`,
          `-rw-r--r-- user/group 1 2026-07-15 12:00 ${entry}\n`,
        ),
      ).toThrow(ApplicationArchiveValidationError);
    },
  );

  test.each(["l", "h", "b", "c", "p", "s"])(
    "rejects a special or link entry type: %s",
    (entryType) => {
      expect(() =>
        validateApplicationArchiveListings(
          100,
          "project/entry\n",
          `${entryType}rwxr-xr-x user/group 1 2026-07-15 12:00 project/entry\n`,
        ),
      ).toThrow(ApplicationArchiveValidationError);
    },
  );

  test("rejects duplicate paths and excessive compression", () => {
    expect(() =>
      validateApplicationArchiveListings(
        100,
        "project/file\nproject/file\n",
        "-rw-r--r-- user/group 1 2026-07-15 12:00 project/file\n-rw-r--r-- user/group 1 2026-07-15 12:00 project/file\n",
      ),
    ).toThrow(ApplicationArchiveValidationError);
    expect(() =>
      validateApplicationArchiveListings(
        1,
        "project/file\n",
        "-rw-r--r-- user/group 101 2026-07-15 12:00 project/file\n",
      ),
    ).toThrow(ApplicationArchiveValidationError);
  });
});
