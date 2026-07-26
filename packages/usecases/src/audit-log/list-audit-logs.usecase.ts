import type { IUnitOfWork, ListAuditLogsInput } from "@upstand/domain";

export class ListAuditLogsUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  execute(input: ListAuditLogsInput) {
    return this.uow.auditLogRepository.list(input);
  }
}
