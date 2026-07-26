export const dockerLogLevels = [
  "error",
  "warning",
  "success",
  "info",
  "debug",
] as const;

export type DockerLogLevel = (typeof dockerLogLevels)[number];

export type DockerLogFilter = {
  search?: string;
  levels?: DockerLogLevel[];
};

/** Docker does not attach severity to ordinary container logs, so use the same conservative text classification as the dashboard. */
export function getDockerLogLevel(message: string): DockerLogLevel {
  const lower = message.toLowerCase();
  if (
    /(?:^|\s)(?:error|err|fatal|critical):?\s/i.test(lower) ||
    /\b(?:exception|failed|failure|crash|uncaught|unhandled)\b/i.test(lower) ||
    /\[(?:error|err|fatal)\]/i.test(lower)
  )
    return "error";
  if (
    /(?:^|\s)(?:warning|warn):?\s/i.test(lower) ||
    /\[(?:warn(?:ing)?|attention)\]/i.test(lower) ||
    /\b(?:deprecated|obsolete|unstable|experimental)\b/i.test(lower) ||
    /⚠|⚠️/i.test(lower)
  )
    return "warning";
  if (
    /\[(?:success|ok|done)\]/i.test(lower) ||
    /\b(?:success(?:ful)?|completed|ready|started|starting|active)\b/i.test(
      lower,
    )
  )
    return "success";
  if (
    /\[(?:info|information|status|state|progress)\]/i.test(lower) ||
    /\b(?:status|state|progress|processing|executing|performing)\b/i.test(lower)
  )
    return "info";
  if (
    /\[(?:debug|trace|server|db|api|http|request|response)\]/i.test(lower) ||
    /\b(?:debug|trace|version|config)\b/i.test(lower)
  )
    return "debug";
  return "info";
}

export function cleanDockerLogs(
  input: Buffer | string | null | undefined,
): string {
  if (!input) return "";

  let rawString = "";

  if (Buffer.isBuffer(input)) {
    let result = "";
    let offset = 0;
    let isHeaderMultiplexed = false;

    while (offset + 8 <= input.length) {
      const streamType = input[offset];
      if (
        (streamType === 1 || streamType === 2) &&
        input[offset + 1] === 0 &&
        input[offset + 2] === 0 &&
        input[offset + 3] === 0
      ) {
        const size = input.readUInt32BE(offset + 4);
        if (offset + 8 + size <= input.length) {
          isHeaderMultiplexed = true;
          result += input.toString("utf8", offset + 8, offset + 8 + size);
          offset += 8 + size;
          continue;
        }
      }
      break;
    }

    if (isHeaderMultiplexed && offset === input.length) {
      rawString = result;
    } else {
      rawString = input.toString("utf8");
    }
  } else {
    rawString = String(input);
  }

  return rawString
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

export function filterDockerLogs(
  logs: string,
  filter?: DockerLogFilter | null,
): string {
  const cleaned = cleanDockerLogs(logs);
  const search = filter?.search?.trim().toLowerCase();
  const levels = new Set(filter?.levels ?? []);
  if (!search && levels.size === 0) return cleaned;
  return cleaned
    .split(/\r?\n/)
    .filter((line) => {
      if (!line) return false;
      if (search && !line.toLowerCase().includes(search)) return false;
      return levels.size === 0 || levels.has(getDockerLogLevel(line));
    })
    .join("\n");
}
