import { describe, expect, test } from "bun:test";
import type { Certificate } from "@upstand/domain";
import { mockUnitOfWork } from "../testing/mock-unit-of-work";
import {
  CreateCertificateInputSchema,
  CreateCertificateUseCase,
  DeleteCertificateUseCase,
  ListCertificatesUseCase,
  UpdateCertificateUseCase,
} from "./certificate.usecases";

const certificatePem =
  "-----BEGIN CERTIFICATE-----\ncertificate\n-----END CERTIFICATE-----";
const privateKeyPem =
  "-----BEGIN PRIVATE KEY-----\nprivate-key\n-----END PRIVATE KEY-----";

function certificate(overrides: Partial<Certificate> = {}): Certificate {
  return {
    id: "certificate-1",
    organizationId: "organization-1",
    name: "Production certificate",
    certificatePem,
    privateKeyPem,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("certificate use cases", () => {
  test("accepts PEM certificates and supported private-key PEM variants", () => {
    expect(
      CreateCertificateInputSchema.parse({
        organizationId: "organization-1",
        name: "  Production certificate ",
        certificatePem,
        privateKeyPem,
      }),
    ).toMatchObject({ name: "Production certificate" });

    expect(() =>
      CreateCertificateInputSchema.parse({
        organizationId: "organization-1",
        name: "certificate",
        certificatePem: "not pem",
        privateKeyPem: "not pem",
      }),
    ).toThrow();

    expect(() =>
      CreateCertificateInputSchema.parse({
        organizationId: "organization-1",
        name: "certificate",
        certificatePem: "-----BEGIN CERTIFICATE-----\ntruncated",
        privateKeyPem,
      }),
    ).toThrow("Certificate must be PEM encoded");

    expect(() =>
      CreateCertificateInputSchema.parse({
        organizationId: "organization-1",
        name: "certificate",
        certificatePem,
        privateKeyPem: "-----BEGIN PRIVATE KEY-----\ntruncated",
      }),
    ).toThrow("Private key must be PEM encoded");
  });

  test("creates a certificate in a transaction with a generated id", async () => {
    let received: Record<string, unknown> | undefined;
    const uow = mockUnitOfWork({
      certificateRepository: {
        create: async (input: Record<string, unknown>) => {
          received = input;
          return certificate({ id: String(input.id) });
        },
      },
    });

    const result = await new CreateCertificateUseCase(uow).execute({
      organizationId: "organization-1",
      name: "Production certificate",
      certificatePem,
      privateKeyPem,
    });

    expect(result.organizationId).toBe("organization-1");
    expect(received).toMatchObject({
      organizationId: "organization-1",
      name: "Production certificate",
      certificatePem,
      privateKeyPem,
    });
    expect(received?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("lists, partially updates, and deletes certificates", async () => {
    const existing = certificate();
    const calls: string[] = [];
    const uow = mockUnitOfWork({
      certificateRepository: {
        findByOrganizationId: async (organizationId: string) => {
          calls.push(`list:${organizationId}`);
          return [existing];
        },
        updateById: async (id: string, patch: Partial<Certificate>) => {
          calls.push(`update:${id}`);
          return certificate({ ...existing, ...patch });
        },
        deleteById: async (id: string) => {
          calls.push(`delete:${id}`);
          return true;
        },
      },
    });

    await expect(
      new ListCertificatesUseCase(uow).execute({
        organizationId: "organization-1",
      }),
    ).resolves.toEqual([existing]);
    await expect(
      new UpdateCertificateUseCase(uow).execute({
        id: existing.id,
        name: "Rotated certificate",
      }),
    ).resolves.toMatchObject({ name: "Rotated certificate" });
    await expect(
      new DeleteCertificateUseCase(uow).execute({ id: existing.id }),
    ).resolves.toBe(true);
    expect(calls).toEqual([
      "list:organization-1",
      "update:certificate-1",
      "delete:certificate-1",
    ]);
  });
});
