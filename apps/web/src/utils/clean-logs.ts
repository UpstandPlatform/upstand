export function cleanDockerLogs(input: string | null | undefined): string {
  if (!input) return "";
  return String(input)
    .split(/\r?\n/)
    .map((line) =>
      line
        // biome-ignore lint/suspicious/noControlCharactersInRegex: Log sanitizer intentionally matches control characters.
        .replace(/^[\x00-\x1F\x7F-\x9F\uFFFD!]+(?=\d{4}-\d{2}-\d{2}T)/g, "")
        // biome-ignore lint/suspicious/noControlCharactersInRegex: Log sanitizer intentionally matches control characters.
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\uFFFD]+/g, "")
        // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence parser intentionally matches control characters.
        .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, ""),
    )
    .join("\n");
}
