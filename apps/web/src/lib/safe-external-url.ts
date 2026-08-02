/**
 * Convert an untrusted absolute URL into a browser-safe external link.
 *
 * These values may come from provider configuration, templates, or AI output.
 * Restricting the scheme prevents javascript:, data:, and other executable
 * URL handlers from reaching an anchor or window.open call.
 */
export function safeExternalUrl(
  value: string | null | undefined,
): string | undefined {
  if (!value?.trim()) return undefined;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}
