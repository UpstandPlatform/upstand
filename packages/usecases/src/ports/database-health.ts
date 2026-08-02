/** Minimal application port used by readiness probes. */
export interface DatabaseHealthPort {
  ping(): Promise<void>;
}
