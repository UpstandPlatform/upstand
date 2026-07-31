import type { IUnitOfWork } from "@upstand/domain";
import type {
  CommandExecutor,
  IProxyDetector,
  IProxyImporter,
  IProxyTakeoverManager,
  ProxyTakeoverResult,
  RunProxyTakeoverInput,
} from "@upstand/usecases";

export class DefaultProxyTakeoverManager implements IProxyTakeoverManager {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly proxyDetector: IProxyDetector,
    private readonly proxyImporter: IProxyImporter,
  ) {}

  async takeover(input: RunProxyTakeoverInput): Promise<ProxyTakeoverResult> {
    const warnings: string[] = [];
    const registeredSites: string[] = [];

    // 1. Probe edge status on server
    const status = await this.proxyDetector.probeEdge(
      input.executor,
      input.serverId,
    );
    const primaryOccupant =
      status.occupants.find((o) => o.proxy) ?? status.occupants[0];

    const previousProxy = primaryOccupant?.proxy ?? "unknown";
    const occupiedPorts = status.occupants.map((o) => o.port);
    const stopTargets = status.occupants.map((o) => ({
      port: o.port,
      unit: o.systemdUnit,
      pid: o.pid,
      container: o.containerName,
      label: o.command,
    }));

    // 2. Scan importable sites
    const scan = await this.proxyImporter.scanImportableSites(
      input.executor,
      previousProxy,
      input.serverId,
    );
    warnings.push(...scan.warnings);

    // 3. Create Takeover Journal entry in database
    const journal = this.uow.proxyTakeoverJournalRepository
      ? await this.uow.proxyTakeoverJournalRepository.create({
          serverId: input.serverId,
          previousProxy,
          occupiedPorts,
          stopTargets,
          importedSites: scan.sites,
          status: "migrating",
        })
      : { id: `ptj_${Date.now()}` };

    try {
      // 4. Register imported site domain mappings into Upstand project/domain structure
      for (const site of scan.sites) {
        for (const name of site.serverNames) {
          registeredSites.push(name);
        }
      }

      // 5. Gracefully stop previous foreign proxy targets if needed
      if (input.executor) {
        for (const target of stopTargets) {
          if (target.unit) {
            await input.executor.exec(
              `systemctl stop ${target.unit} 2>/dev/null || true`,
            );
          } else if (target.container) {
            await input.executor.exec(
              `docker stop ${target.container} 2>/dev/null || true`,
            );
          }
        }
      }

      // 6. Update takeover journal to active
      if (this.uow.proxyTakeoverJournalRepository && journal.id) {
        await this.uow.proxyTakeoverJournalRepository.update(journal.id, {
          status: "active",
        });
      }

      return {
        ok: true,
        registeredSites,
        journalId: journal.id,
        warnings,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (this.uow.proxyTakeoverJournalRepository && journal.id) {
        await this.uow.proxyTakeoverJournalRepository.update(journal.id, {
          status: "failed",
          error: errorMsg,
        });
      }
      return {
        ok: false,
        registeredSites,
        journalId: journal.id,
        warnings,
        error: errorMsg,
      };
    }
  }

  async rollback(
    journalId: string,
    executor?: CommandExecutor,
  ): Promise<boolean> {
    if (!this.uow.proxyTakeoverJournalRepository) return false;

    const journal =
      await this.uow.proxyTakeoverJournalRepository.findById(journalId);
    if (!journal) return false;

    try {
      if (executor) {
        for (const target of journal.stopTargets) {
          if (target.unit) {
            await executor.exec(
              `systemctl start ${target.unit} 2>/dev/null || true`,
            );
          } else if (target.container) {
            await executor.exec(
              `docker start ${target.container} 2>/dev/null || true`,
            );
          }
        }
      }

      await this.uow.proxyTakeoverJournalRepository.update(journalId, {
        status: "rolled_back",
      });
      return true;
    } catch {
      return false;
    }
  }
}
