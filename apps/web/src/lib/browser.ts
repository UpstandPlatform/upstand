const UNSAFE_FILENAME_CHARACTERS = /[<>:"/\\|?*]/g;

export function normalizeDownloadFilename(filename: string): string {
  const normalized = filename
    .replace(UNSAFE_FILENAME_CHARACTERS, "-")
    .split("")
    .map((character) => (character.charCodeAt(0) <= 0x1f ? "-" : character))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "");

  return normalized || "download";
}

export async function copyText(value: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    throw new Error("Clipboard access is unavailable in this browser.");
  }

  await navigator.clipboard.writeText(value);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = normalizeDownloadFilename(filename);
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadText(
  value: string,
  filename: string,
  mimeType = "text/plain;charset=utf-8",
): void {
  downloadBlob(new Blob([value], { type: mimeType }), filename);
}

export function downloadJson(value: unknown, filename: string): void {
  downloadText(
    `${JSON.stringify(value, null, 2)}\n`,
    filename,
    "application/json",
  );
}
