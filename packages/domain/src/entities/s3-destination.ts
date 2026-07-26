import { z } from "zod";

export const S3DestinationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  provider: z.string(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  bucket: z.string(),
  region: z.string(),
  endpoint: z.string(),
  certificateId: z.string().nullable().optional(),
  additionalFlags: z.string(), // JSON string representing string[]
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type S3Destination = z.infer<typeof S3DestinationSchema>;

export interface CreateS3DestinationDTO {
  id?: string;
  organizationId: string;
  name: string;
  provider: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
  endpoint: string;
  certificateId?: string | null;
  additionalFlags?: string;
}
