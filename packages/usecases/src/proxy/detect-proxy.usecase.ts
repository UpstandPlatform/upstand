import type { EdgeStatus, IUnitOfWork } from "@upstand/domain";
import type { IProxyDetector } from "../ports/proxy";

export class DetectProxyUseCase {
  constructor(
    _uow: IUnitOfWork,
    private readonly proxyDetector: IProxyDetector,
  ) {}

  async execute(options: { serverId?: string } = {}): Promise<EdgeStatus> {
    return this.proxyDetector.probeEdge(undefined, options.serverId);
  }
}
