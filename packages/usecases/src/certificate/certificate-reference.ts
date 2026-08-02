import type { IUnitOfWork } from "@upstand/domain";
import { ValidationError } from "@upstand/domain";

export async function resolveCertificateForOrganization(
  uow: Pick<IUnitOfWork, "certificateRepository">,
  certificateId: string | null | undefined,
  organizationId: string,
) {
  if (!certificateId) return null;

  const certificate = await uow.certificateRepository.findById(certificateId);
  if (!certificate || certificate.organizationId !== organizationId) {
    throw new ValidationError(
      "Selected certificate is not available to this organization",
    );
  }
  return certificate;
}
