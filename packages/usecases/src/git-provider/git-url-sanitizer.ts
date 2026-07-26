/**
 * Sanitizes and validates Git repository URLs to prevent second-order command injection
 * via option flags (e.g. --upload-pack, -oProxyCommand, --config) passed to shell commands like `git ls-remote` or `git clone`.
 */

const CONTROL_CHARACTERS_REGEX = /[\r\n\0]/;

export function sanitizeGitUrl(rawUrl: string): string {
  if (typeof rawUrl !== "string") {
    throw new Error("Git URL must be a string");
  }

  if (CONTROL_CHARACTERS_REGEX.test(rawUrl)) {
    throw new Error("Git URL contains invalid control characters");
  }

  const url = rawUrl.trim();

  if (!url) {
    throw new Error("Git URL cannot be empty");
  }

  if (url.startsWith("-")) {
    throw new Error("Git URL cannot start with a dash or flag parameter");
  }

  // Ensure SSH URLs or HTTP/HTTPS URLs follow safe structures
  if (/\s/.test(url)) {
    throw new Error("Git URL cannot contain whitespace");
  }

  return url;
}

export function assertSafeGitUrl(url: string): void {
  sanitizeGitUrl(url);
}

/** Validate a user-supplied branch or tag before passing it to Git. */
export function assertSafeGitRef(value: string): string {
  const ref = value.trim();
  if (
    !ref ||
    ref.length > 255 ||
    ref.startsWith("-") ||
    ref.includes("..") ||
    ref.includes("@{") ||
    ref.includes("\\") ||
    ref.includes("//") ||
    ref
      .split("/")
      .some((part) => part === "" || part === "." || part === "..") ||
    ref.endsWith(".") ||
    ref.endsWith(".lock") ||
    [...ref].some(
      (character) =>
        character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f,
    ) ||
    !/^[A-Za-z0-9._/-]+$/.test(ref)
  ) {
    throw new Error("Git branch or tag is not a valid Git reference");
  }
  return ref;
}
