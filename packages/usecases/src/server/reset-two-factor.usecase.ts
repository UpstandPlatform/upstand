import type { IUnitOfWork, TwoFactorAdminUser } from "@upstand/domain";

export class ResetTwoFactorUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  listEnabledUsers(): Promise<TwoFactorAdminUser[]> {
    return this.uow.twoFactorAdminRepository.findEnabledUsers();
  }

  findUserByEmail(email: string): Promise<TwoFactorAdminUser | null> {
    return this.uow.twoFactorAdminRepository.findUserByEmail(email);
  }

  reset(userId: string): Promise<void> {
    return this.uow.twoFactorAdminRepository.resetForUser(userId);
  }
}
