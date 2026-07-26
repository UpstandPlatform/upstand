/**
 * Utility functions and type registries for managing prompt attachments.
 */

export interface AttachmentCategoryConfig {
  id: string;
  name: string;
  mimeTypes: string[];
  extensions: string[];
}

/**
 * Standard registry of supported attachment categories.
 * Designed to be cleanly extended with future media types (e.g. images, audio, pdfs).
 */
export const ATTACHMENT_CATEGORIES: Record<string, AttachmentCategoryConfig> = {
  text: {
    id: "text",
    name: "Text & Markdown",
    mimeTypes: [
      "text/plain",
      "text/markdown",
      "text/x-markdown",
      "text/csv",
      "text/yaml",
      "text/x-yaml",
      "application/json",
    ],
    extensions: [
      ".txt",
      ".md",
      ".markdown",
      ".log",
      ".json",
      ".yaml",
      ".yml",
      ".csv",
    ],
  },
  image: {
    id: "image",
    name: "Images",
    mimeTypes: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "image/svg+xml",
    ],
    extensions: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"],
  },
};

const EXTENSION_TO_MIME: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".json": "application/json",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".csv": "text/csv",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

/**
 * Default accept filter string for UpGal chat attachments.
 * Accepts common text, markdown, log, and configuration files.
 */
export const UPGAL_ACCEPT_PATTERNS = ATTACHMENT_CATEGORIES.text.extensions
  .concat(ATTACHMENT_CATEGORIES.text.mimeTypes)
  .join(",");

/**
 * Infer the media (MIME) type of a file based on its name and browser-reported type.
 * Useful when the OS/browser leaves `file.type` as empty string (e.g., .md on Windows).
 */
export function inferMediaType(
  filename: string,
  reportedType?: string,
): string {
  if (reportedType && reportedType.trim() !== "") {
    return reportedType;
  }
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex !== -1) {
    const ext = filename.slice(dotIndex).toLowerCase();
    if (EXTENSION_TO_MIME[ext]) {
      return EXTENSION_TO_MIME[ext];
    }
  }
  return "application/octet-stream";
}

/**
 * Check whether a file matches an HTML accept pattern string.
 * Supports file extensions (.md, .txt), exact MIME types (text/markdown),
 * and wildcard MIME types (text/*).
 */
export function matchesAcceptPattern(
  file: { name: string; type: string },
  accept?: string,
): boolean {
  if (!accept || accept.trim() === "") {
    return true;
  }

  const resolvedType = inferMediaType(file.name, file.type);
  const fileNameLower = file.name.toLowerCase();

  const patterns = accept
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return patterns.some((pattern) => {
    const patternLower = pattern.toLowerCase();
    // Extension match (e.g. ".md", ".txt")
    if (patternLower.startsWith(".")) {
      return fileNameLower.endsWith(patternLower);
    }
    // Wildcard MIME match (e.g. "text/*", "image/*")
    if (patternLower.endsWith("/*")) {
      const prefix = patternLower.slice(0, -1); // e.g. "text/"
      return (
        file.type.toLowerCase().startsWith(prefix) ||
        resolvedType.toLowerCase().startsWith(prefix)
      );
    }
    // Exact MIME match (e.g. "text/markdown", "text/plain")
    return (
      file.type.toLowerCase() === patternLower ||
      resolvedType.toLowerCase() === patternLower
    );
  });
}
