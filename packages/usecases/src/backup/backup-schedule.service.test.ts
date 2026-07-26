import { describe, expect, test } from "bun:test";
import type { CreateBackupScheduleInput, Resource } from "@upstand/domain";
import {
  normalizeBackupScheduleInput,
  validateBackupSchedule,
} from "./backup-schedule.service";

const databaseResource: Resource = {
  id: "resource-1",
  environmentId: "environment-1",
  name: "Postgres",
  appName: "postgres",
  type: "database",
  status: "running",
  provider: "postgres",
  dbType: "postgres",
  buildConfig: "{}",
  advancedConfig: "{}",
  envVars: "{}",
  domains: "[]",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseInput: CreateBackupScheduleInput = {
  resourceId: databaseResource.id,
  destinationId: "destination-1",
  name: "Nightly database",
  kind: "database",
  cronExpression: "0 2 * * *",
  timezone: "UTC",
  prefix: "production",
  retentionCount: 7,
  enabled: true,
  databaseName: "app",
  databaseEngine: "postgres",
  stopService: false,
};

describe("backup schedule validation", () => {
  test("accepts a five-field cron expression with an IANA timezone", () => {
    const input = normalizeBackupScheduleInput(baseInput, databaseResource);
    expect(() => validateBackupSchedule(input)).not.toThrow();
  });

  test("rejects schedules without a valid timezone", () => {
    expect(() =>
      validateBackupSchedule({ ...baseInput, timezone: "Not/A-Timezone" }),
    ).toThrow("Invalid backup schedule");
  });

  test("requires source credentials for a compose database unless an encrypted value already exists", () => {
    const composeResource = {
      ...databaseResource,
      type: "compose",
      dbType: undefined,
    } as Resource;
    expect(() =>
      normalizeBackupScheduleInput(baseInput, composeResource),
    ).toThrow("require source database credentials");
    expect(() =>
      normalizeBackupScheduleInput(baseInput, composeResource, {
        allowExistingSourceCredentials: true,
      }),
    ).not.toThrow();
  });

  test("accepts Redis RDB schedules without a logical database name", () => {
    const redisResource = {
      ...databaseResource,
      dbType: "redis",
      provider: "redis",
    } as Resource;
    const input = normalizeBackupScheduleInput(
      { ...baseInput, databaseName: undefined, databaseEngine: "redis" },
      redisResource,
    );
    expect(input.databaseEngine).toBe("redis");
    expect(() => validateBackupSchedule(input)).not.toThrow();
  });

  test("requires backup replica settings to match the resource HA policy", () => {
    expect(() =>
      normalizeBackupScheduleInput(
        { ...baseInput, replicaCount: 1, failoverEnabled: true },
        databaseResource,
      ),
    ).toThrow("must match Advanced > Health & Deploy");

    const haResource = {
      ...databaseResource,
      advancedConfig: JSON.stringify({
        databaseReplication: {
          enabled: true,
          replicaCount: 1,
          automaticFailover: true,
          replicationUser: "repmgr",
        },
      }),
    };
    expect(() =>
      normalizeBackupScheduleInput(
        { ...baseInput, replicaCount: 1, failoverEnabled: true },
        haResource,
      ),
    ).not.toThrow();
  });
});
