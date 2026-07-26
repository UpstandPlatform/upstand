import { z } from "zod";

export const CertificateSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  certificatePem: z.string(),
  privateKeyPem: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Certificate = z.infer<typeof CertificateSchema>;

export interface CreateCertificateDTO {
  id?: string;
  organizationId: string;
  name: string;
  certificatePem: string;
  privateKeyPem: string;
}
