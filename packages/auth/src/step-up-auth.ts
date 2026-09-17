const STEP_UP_TTL_SECONDS = 15 * 60;
const STEP_UP_VERSION = 1;

export type StepUpSession = {
  user: { id: string; twoFactorEnabled?: boolean | null };
  session: { id: string };
};

type StepUpRecord = {
  version: number;
  userId: string;
  sessionId: string;
  verifiedAt: number;
  expiresAt: number;
  purpose: "sensitive-operations";
};

type UnknownRecord = Record<string, unknown>;

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isStepUpRecord(value: unknown): value is StepUpRecord {
  if (!isUnknownRecord(value)) return false;
  return (
    typeof value.version === "number" &&
    typeof value.userId === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.verifiedAt === "number" &&
    typeof value.expiresAt === "number" &&
    value.purpose === "sensitive-operations"
  );
}

export interface StepUpStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface StepUpAuth {
  recordStepUpVerification(session: StepUpSession): Promise<void>;
  clearStepUpVerification(sessionId: string): Promise<void>;
  isStepUpAuthenticationSatisfied(session: StepUpSession): Promise<boolean>;
}

export function stepUpKey(sessionId: string): string {
  return `2fa-verified:${sessionId}`;
}

export function createStepUpAuth(storage: StepUpStorage): StepUpAuth {
  return {
    async recordStepUpVerification(session) {
      const now = Math.floor(Date.now() / 1000);
      const record: StepUpRecord = {
        version: STEP_UP_VERSION,
        userId: session.user.id,
        sessionId: session.session.id,
        verifiedAt: now,
        expiresAt: now + STEP_UP_TTL_SECONDS,
        purpose: "sensitive-operations",
      };
      await storage.set(
        stepUpKey(session.session.id),
        JSON.stringify(record),
        "EX",
        STEP_UP_TTL_SECONDS,
      );
    },

    async clearStepUpVerification(sessionId) {
      await storage.del(stepUpKey(sessionId));
    },

    async isStepUpAuthenticationSatisfied(session) {
      const twoFactorEnabled = session.user.twoFactorEnabled === true;
      if (!twoFactorEnabled) return true;
      const verificationValue = await storage.get(
        stepUpKey(session.session.id),
      );
      return isStepUpVerificationValid(twoFactorEnabled, verificationValue, {
        userId: session.user.id,
        sessionId: session.session.id,
      });
    },
  };
}

export function isStepUpVerificationValid(
  twoFactorEnabled: boolean,
  verificationValue: string | null,
  expected?: { userId: string; sessionId: string },
): boolean {
  if (!twoFactorEnabled) return true;
  if (!verificationValue) return false;
  try {
    const parsed: unknown = JSON.parse(verificationValue);
    if (!isStepUpRecord(parsed)) return false;
    const record: StepUpRecord = parsed;
    const now = Math.floor(Date.now() / 1000);
    return (
      record.version === STEP_UP_VERSION &&
      record.purpose === "sensitive-operations" &&
      record.userId === expected?.userId &&
      record.sessionId === expected?.sessionId &&
      typeof record.verifiedAt === "number" &&
      typeof record.expiresAt === "number" &&
      record.expiresAt >= now
    );
  } catch {
    return false;
  }
}
