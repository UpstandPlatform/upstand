import { rmSync } from "node:fs";

export function consumeChangesetFiles(paths: readonly string[]): void {
  for (const path of paths) {
    rmSync(path, { force: true });
  }
}

export function mergeReleaseNotesIntoChangelog(
  changelog: string,
  releaseVersion: string,
  releaseNotes: readonly string[],
  releaseDate: string,
): string {
  const normalizedChangelog = changelog.replaceAll("\r\n", "\n");
  const lines = normalizedChangelog.split("\n");
  const releaseHeading = `## ${releaseVersion} -`;
  const releaseHeadingIndex = lines.findIndex((line) =>
    line.startsWith(releaseHeading),
  );
  const nextHeadingIndex =
    releaseHeadingIndex < 0
      ? -1
      : lines.findIndex(
          (line, index) =>
            index > releaseHeadingIndex && line.startsWith("## "),
        );
  const existingReleaseSection =
    releaseHeadingIndex < 0
      ? ""
      : lines
          .slice(
            releaseHeadingIndex + 1,
            nextHeadingIndex < 0 ? lines.length : nextHeadingIndex,
          )
          .join("\n");
  const notesToAdd = releaseNotes.filter((note) => {
    if (releaseHeadingIndex < 0) {
      return true;
    }
    return !existingReleaseSection.includes(note);
  });

  if (notesToAdd.length === 0) {
    return normalizedChangelog;
  }

  const noteLines = notesToAdd.flatMap((note, index) =>
    index === 0 ? [note] : ["", note],
  );
  if (releaseHeadingIndex >= 0) {
    let insertionIndex = nextHeadingIndex < 0 ? lines.length : nextHeadingIndex;
    if (
      insertionIndex > releaseHeadingIndex + 1 &&
      lines[insertionIndex - 1] === ""
    ) {
      insertionIndex -= 1;
    }
    lines.splice(insertionIndex, 0, "", ...noteLines);
    return lines.join("\n");
  }

  const unreleasedIndex = lines.indexOf("## Unreleased");
  if (unreleasedIndex < 0) {
    throw new Error("CHANGELOG.md must contain an Unreleased section.");
  }

  lines.splice(
    unreleasedIndex + 1,
    0,
    "",
    `## ${releaseVersion} - ${releaseDate}`,
    "",
    ...noteLines,
    "",
  );
  return lines.join("\n");
}
