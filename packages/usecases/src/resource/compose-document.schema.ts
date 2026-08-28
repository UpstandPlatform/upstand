import { z } from "zod";

export const COMPOSE_DOCUMENT_MAX_BYTES = 1_048_576;

export const ComposeDocumentSchema = z
  .string()
  .trim()
  .min(1, "Compose file is required")
  .max(COMPOSE_DOCUMENT_MAX_BYTES, "Compose files must not exceed 1 MB")
  .refine(
    (value) =>
      new TextEncoder().encode(value).byteLength <= COMPOSE_DOCUMENT_MAX_BYTES,
    "Compose files must not exceed 1 MB when encoded as UTF-8",
  );
