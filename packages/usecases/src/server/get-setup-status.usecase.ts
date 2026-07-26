import type { IUnitOfWork } from "@upstand/domain";

export class GetSetupStatusUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(): Promise<{ needsOwnerSetup: boolean }> {
    return {
      needsOwnerSetup: (await this.uow.userRepository.count()) === 0,
    };
  }
}
