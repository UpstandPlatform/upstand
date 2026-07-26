import type { CreateAuditLog, IUnitOfWork } from "@upstand/domain";

export class CreateAuditLogUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: CreateAuditLog): Promise<void> {
    await this.uow.auditLogRepository.create(input);
  }
}
