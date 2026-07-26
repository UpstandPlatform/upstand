import type { S3Destination } from "@upstand/domain";

export const REDACTED_S3_SECRET = "********";

export function publicS3Destination(destination: S3Destination): S3Destination {
  return {
    ...destination,
    accessKeyId: REDACTED_S3_SECRET,
    secretAccessKey: REDACTED_S3_SECRET,
  };
}
