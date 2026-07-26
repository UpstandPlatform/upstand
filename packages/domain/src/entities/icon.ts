import { z } from "zod";

export const MAX_ICON_SIZE_BYTES = 512 * 1024; // 512 KB

export const ALLOWED_ICON_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;

export type AllowedIconMimeType = (typeof ALLOWED_ICON_MIME_TYPES)[number];

export const IconDataUriSchema = z.string().superRefine((val, ctx) => {
  if (val.length > MAX_ICON_SIZE_BYTES * 1.4) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Icon image data exceeds maximum size limit (512 KB)",
    });
    return;
  }

  if (val.startsWith("data:")) {
    const match =
      /^data:(image\/(?:png|jpeg|jpg|webp|gif|svg\+xml));(?:base64|utf8),/i.exec(
        val,
      );
    if (!match) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Invalid image data URI. Supported formats: PNG, JPEG, WebP, GIF, SVG",
      });
    }
  } else if (val.startsWith("http://") || val.startsWith("https://")) {
    try {
      new URL(val);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid image URL format",
      });
    }
  } else if (val.startsWith("preset:")) {
    const presetName = val.slice(7);
    if (!/^[a-zA-Z0-9_-]+$/.test(presetName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid preset icon identifier",
      });
    }
  } else {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Icon must be a valid Data URI, HTTP/HTTPS URL, or preset identifier",
    });
  }
});

export const EntityIconSchema = IconDataUriSchema.nullable().optional();
