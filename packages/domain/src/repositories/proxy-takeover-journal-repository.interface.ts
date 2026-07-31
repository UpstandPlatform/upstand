import type { ProxyTakeoverJournal } from "../entities/proxy";

export interface CreateProxyTakeoverJournalInput {
  serverId: string;
  previousProxy: ProxyTakeoverJournal["previousProxy"];
  occupiedPorts: number[];
  stopTargets: ProxyTakeoverJournal["stopTargets"];
  importedSites: ProxyTakeoverJournal["importedSites"];
  status?: ProxyTakeoverJournal["status"];
  error?: string | null;
}

export interface UpdateProxyTakeoverJournalInput {
  status?: ProxyTakeoverJournal["status"];
  importedSites?: ProxyTakeoverJournal["importedSites"];
  error?: string | null;
}

export interface IProxyTakeoverJournalRepository {
  findById(id: string): Promise<ProxyTakeoverJournal | null>;
  findLatestByServerId(serverId: string): Promise<ProxyTakeoverJournal | null>;
  findManyByServerId(serverId: string): Promise<ProxyTakeoverJournal[]>;
  create(input: CreateProxyTakeoverJournalInput): Promise<ProxyTakeoverJournal>;
  update(
    id: string,
    input: UpdateProxyTakeoverJournalInput,
  ): Promise<ProxyTakeoverJournal | null>;
  delete(id: string): Promise<boolean>;
}
