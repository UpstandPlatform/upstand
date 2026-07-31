import type { IUnitOfWork } from "@upstand/domain";
import type {
  IProxyTakeoverManager,
  ProxyTakeoverResult,
} from "../ports/proxy";

export class TakeoverProxyUseCase {
  constructor(
    _uow: IUnitOfWork,
    private readonly takeoverManager: IProxyTakeoverManager,
  ) {}

  async execute(options: {
    serverId: string;
    acmeEmail?: string;
  }): Promise<ProxyTakeoverResult> {
    return this.takeoverManager.takeover({
      serverId: options.serverId,
      acmeEmail: options.acmeEmail,
    });
  }

  async rollback(options: { journalId: string }): Promise<boolean> {
    return this.takeoverManager.rollback(options.journalId);
  }
}
