import type {
  SecretRotationSchedule,
  SecretScopeType,
} from "../entities/secret";

export interface CreateSecretRotationScheduleDTO {
  id: string;
  organizationId: string;
  scopeType: SecretScopeType;
  scopeId: string;
  keys: string[];
  intervalHours: number;
  valueLength: number;
  enabled: boolean;
  lastRotatedAt?: Date | null;
  rotationClaimedUntil?: Date | null;
}

export interface ISecretRotationScheduleRepository {
  findById(id: string): Promise<SecretRotationSchedule | null>;
  findByScope(
    scopeType: SecretScopeType,
    scopeId: string,
  ): Promise<SecretRotationSchedule[]>;
  findDue(now: Date): Promise<SecretRotationSchedule[]>;
  claimDue(
    id: string,
    now: Date,
    claimUntil: Date,
  ): Promise<SecretRotationSchedule | null>;
  create(
    data: CreateSecretRotationScheduleDTO,
  ): Promise<SecretRotationSchedule>;
  updateById(
    id: string,
    patch: Partial<
      Omit<
        CreateSecretRotationScheduleDTO,
        "id" | "organizationId" | "scopeType" | "scopeId"
      >
    >,
  ): Promise<SecretRotationSchedule | null>;
  deleteById(id: string): Promise<boolean>;
}
