export const DEFAULT_ARCHIVE_MAX_BYTES = 50 * 1024 * 1024;

export interface ArchiveFileValidationOptions {
  extensions?: readonly string[];
  maxBytes?: number;
}

export function validateArchiveFile(
  file: File,
  options: ArchiveFileValidationOptions = {},
): string | null {
  if (file.size === 0) return "The selected archive is empty.";

  const maxBytes = options.maxBytes ?? DEFAULT_ARCHIVE_MAX_BYTES;
  if (file.size > maxBytes) {
    return `Archive must not exceed ${Math.round(maxBytes / 1024 / 1024)} MB.`;
  }

  const extensions = options.extensions ?? [".tar"];
  const filename = file.name.toLowerCase();
  if (!extensions.some((extension) => filename.endsWith(extension))) {
    return `Supported archive types: ${extensions.join(", ")}.`;
  }

  return null;
}

export function validateArchiveDestination(destination: string): string | null {
  const normalized = destination.trim();
  if (!normalized) return "A destination path is required.";
  if (!normalized.startsWith("/")) {
    return "The destination must be an absolute path.";
  }
  if (normalized.includes("\u0000")) {
    return "The destination contains an invalid character.";
  }
  return null;
}

export async function uploadArchive({
  url,
  file,
  signal,
}: {
  url: string;
  file: File;
  signal?: AbortSignal;
}): Promise<unknown> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(url, {
    method: "POST",
    body: formData,
    credentials: "include",
    signal,
  });
  const responseText = await response.text();
  let result: { error?: string } = {};
  try {
    result = JSON.parse(responseText) as { error?: string };
  } catch {
    // Preserve the server's text response below when it is not JSON.
  }

  if (!response.ok) {
    throw new Error(
      result.error ||
        responseText ||
        `Upload failed with status ${response.status}`,
    );
  }

  return result;
}
