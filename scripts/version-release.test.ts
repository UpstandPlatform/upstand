import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  consumeChangesetFiles,
  mergeReleaseNotesIntoChangelog,
} from "./version-release-helpers";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("consumeChangesetFiles", () => {
  test("removes consumed notes and tolerates notes already removed by Changesets", () => {
    const directory = mkdtempSync(join(tmpdir(), "upstand-version-release-"));
    temporaryDirectories.push(directory);
    const consumed = join(directory, "consumed.md");
    const alreadyConsumed = join(directory, "already-consumed.md");
    writeFileSync(consumed, "---\n---\nrelease note\n");

    consumeChangesetFiles([consumed, alreadyConsumed]);

    expect(existsSync(consumed)).toBe(false);
    expect(existsSync(alreadyConsumed)).toBe(false);
  });
});

describe("mergeReleaseNotesIntoChangelog", () => {
  test("adds missing notes to an existing release section without duplicates", () => {
    const changelog = [
      "## Unreleased",
      "",
      "## 0.2.27 - 2026-08-27",
      "",
      "Existing release note.",
      "",
      "## 0.2.26 - 2026-08-21",
      "",
      "Older release note.",
      "",
    ].join("\n");

    const updated = mergeReleaseNotesIntoChangelog(
      changelog,
      "0.2.27",
      ["Existing release note.", "New release note."],
      "2026-08-27",
    );

    expect(updated).toContain("Existing release note.\n\nNew release note.");
    expect(updated.match(/Existing release note\./g)).toHaveLength(1);
  });

  test("creates a release section below Unreleased when the version is new", () => {
    const updated = mergeReleaseNotesIntoChangelog(
      "## Unreleased\n\n## 0.2.26 - 2026-08-21\n",
      "0.2.27",
      ["New release note."],
      "2026-08-27",
    );

    expect(updated).toContain(
      "## Unreleased\n\n## 0.2.27 - 2026-08-27\n\nNew release note.",
    );
  });
});
