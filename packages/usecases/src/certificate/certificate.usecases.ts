import { randomUUID } from "node:crypto";
import type { Certificate, IUnitOfWork } from "@upstand/domain";
import { z } from "zod";

const certificatePem = z
  .string()
  .min(1)
  .refine(
    (value) =>
      /^\s*-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(
        value,
      ),
    "Certificate must be PEM encoded",
  );
const privateKeyPem = z
  .string()
  .min(1)
  .refine(
    (value) =>
      /^\s*-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----\s*$/.test(
        value,
      ),
    "Private key must be PEM encoded",
  );

export const CreateCertificateInputSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  certificatePem,
  privateKeyPem,
});
export type CreateCertificateInput = z.infer<
  typeof CreateCertificateInputSchema
>;

export const ListCertificatesInputSchema = z.object({
  organizationId: z.string().min(1),
});
export type ListCertificatesInput = z.infer<typeof ListCertificatesInputSchema>;

export const UpdateCertificateInputSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  certificatePem: certificatePem.optional(),
  privateKeyPem: privateKeyPem.optional(),
});
export type UpdateCertificateInput = z.infer<
  typeof UpdateCertificateInputSchema
>;

export const DeleteCertificateInputSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1).optional(),
});
export type DeleteCertificateInput = z.infer<
  typeof DeleteCertificateInputSchema
>;

export class CreateCertificateUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  async execute(input: CreateCertificateInput): Promise<Certificate> {
    return this.uow.transaction((tx) =>
      tx.certificateRepository.create({
        id: randomUUID(),
        organizationId: input.organizationId,
        name: input.name,
        certificatePem: input.certificatePem,
        privateKeyPem: input.privateKeyPem,
      }),
    );
  }
}

export class ListCertificatesUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  async execute(input: ListCertificatesInput): Promise<Certificate[]> {
    return this.uow.transaction((tx) =>
      tx.certificateRepository.findByOrganizationId(input.organizationId),
    );
  }
}

export class UpdateCertificateUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  async execute(input: UpdateCertificateInput): Promise<Certificate | null> {
    return this.uow.transaction(async (tx) => {
      const existing = await tx.certificateRepository.findById(input.id);
      if (!existing || existing.organizationId !== input.organizationId) {
        return null;
      }
      return tx.certificateRepository.updateById(input.id, {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.certificatePem === undefined
          ? {}
          : { certificatePem: input.certificatePem }),
        ...(input.privateKeyPem === undefined
          ? {}
          : { privateKeyPem: input.privateKeyPem }),
      });
    });
  }
}

export class DeleteCertificateUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  async execute(input: DeleteCertificateInput): Promise<boolean> {
    return this.uow.transaction(async (tx) => {
      const existing = await tx.certificateRepository.findById(input.id);
      if (!existing || existing.organizationId !== input.organizationId) {
        return false;
      }
      return tx.certificateRepository.deleteById(input.id);
    });
  }
}
