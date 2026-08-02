import { describe, expect, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import { resolveCertificateForOrganization } from "./certificate-reference";

describe("certificate organization references", () => {
  const uow = {
    certificateRepository: {
      findById: async (id: string) =>
        id === "cert-1"
          ? {
              id,
              organizationId: "org-1",
            }
          : null,
    },
  } as unknown as Pick<IUnitOfWork, "certificateRepository">;

  test("resolves a certificate owned by the requested organization", async () => {
    await expect(
      resolveCertificateForOrganization(uow, "cert-1", "org-1"),
    ).resolves.toMatchObject({ id: "cert-1" });
  });

  test("rejects a missing or cross-organization certificate", async () => {
    await expect(
      resolveCertificateForOrganization(uow, "cert-1", "org-2"),
    ).rejects.toThrow("not available to this organization");
    await expect(
      resolveCertificateForOrganization(uow, "missing", "org-1"),
    ).rejects.toThrow("not available to this organization");
  });
});
