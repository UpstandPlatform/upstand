import type { IUnitOfWork, ProxyKind, ProxyScanResult } from "@upstand/domain";
import type { IProxyImporter } from "../ports/proxy";

export class ScanProxySitesUseCase {
  constructor(
    _uow: IUnitOfWork,
    private readonly proxyImporter: IProxyImporter,
  ) {}

  async execute(options: {
    serverId?: string;
    proxyKind?: ProxyKind;
  }): Promise<ProxyScanResult> {
    return this.proxyImporter.scanImportableSites(
      undefined,
      options.proxyKind,
      options.serverId,
    );
  }
}
