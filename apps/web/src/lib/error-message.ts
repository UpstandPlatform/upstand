export function getUserFacingError(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  const raw =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "";
  if (!raw) return fallback;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const first = parsed.find((item): item is { message: string } =>
        Boolean(
          item &&
            typeof item === "object" &&
            "message" in item &&
            typeof item.message === "string",
        ),
      );
      if (first?.message) return first.message;
    }
  } catch {
    // The error is already a regular human-readable message.
  }

  return raw.length > 240 ? fallback : raw;
}
