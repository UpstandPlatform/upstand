import type {
  Certificate,
  CreateCertificateDTO,
} from "../entities/certificate";

export interface ICertificateRepository {
  findById(id: string): Promise<Certificate | null>;
  findByOrganizationId(organizationId: string): Promise<Certificate[]>;
  findAll(): Promise<Certificate[]>;
  create(data: CreateCertificateDTO): Promise<Certificate>;
  updateById(
    id: string,
    patch: Partial<CreateCertificateDTO>,
  ): Promise<Certificate | null>;
  deleteById(id: string): Promise<boolean>;
}
