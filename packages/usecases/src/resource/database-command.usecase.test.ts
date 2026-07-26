import { describe, expect, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import { DatabaseCommandUseCase } from "./database-command.usecase";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUseCase(
  dbType: string,
  credentials?: Record<string, string>,
  onRun?: (cmd: string) => string,
) {
  let capturedCommand = "";
  const useCase = new DatabaseCommandUseCase(
    {
      resourceRepository: {
        findById: async () => ({
          id: `db-${dbType}`,
          type: "database",
          dbType,
          serverId: "local",
          ...(credentials ? { credentials: JSON.stringify(credentials) } : {}),
        }),
      },
    } as unknown as IUnitOfWork,
    {
      runCommandInResourceContainer: async (
        _resource: unknown,
        cmd: string,
      ) => {
        capturedCommand = cmd;
        return onRun ? onRun(cmd) : "OK\n";
      },
    } as never,
  );
  return { useCase, getCommand: () => capturedCommand };
}

// ---------------------------------------------------------------------------
// Parameterized: default command resolution for all engines
// ---------------------------------------------------------------------------
describe("database command use case", () => {
  const defaultEngines = [
    {
      dbType: "postgres",
      health: "pg_isready -U postgres",
      version: "postgres --version",
    },
    { dbType: "mysql", health: "mysqladmin ping", version: "mysql --version" },
    {
      dbType: "mariadb",
      health: "mariadb-admin ping",
      version: "mariadb --version",
    },
    {
      dbType: "mongodb",
      health: "mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok'",
      version: "mongod --version",
    },
    {
      dbType: "redis",
      health: "redis-cli ping",
      version: "redis-server --version",
    },
    {
      dbType: "libsql",
      health: "curl -fsS http://127.0.0.1:8080/health",
      version: "sqld --version",
    },
  ];

  for (const engine of defaultEngines) {
    test(`executes health command for ${engine.dbType} (no credentials)`, async () => {
      const { useCase, getCommand } = makeUseCase(engine.dbType);
      const result = await useCase.execute({
        id: `db-${engine.dbType}`,
        command: "health",
      });
      expect(getCommand()).toBe(engine.health);
      expect(result.output).toBe("OK");
    });

    test(`executes version command for ${engine.dbType}`, async () => {
      const { useCase, getCommand } = makeUseCase(
        engine.dbType,
        undefined,
        () => "v1.0.0\n",
      );
      const result = await useCase.execute({
        id: `db-${engine.dbType}`,
        command: "version",
      });
      expect(getCommand()).toBe(engine.version);
      expect(result.output).toBe("v1.0.0");
    });
  }

  // -------------------------------------------------------------------------
  // Credential forwarding — health checks embed credentials into the command
  // -------------------------------------------------------------------------
  test("pg_isready includes -U and -d flags when credentials are set", async () => {
    const { useCase, getCommand } = makeUseCase("postgres", {
      dbUser: "custom_user",
      dbName: "custom_db",
    });
    await useCase.execute({ id: "db-postgres", command: "health" });
    expect(getCommand()).toBe("pg_isready -U custom_user -d custom_db");
  });

  test("pg_isready includes only -U flag when only dbUser is set", async () => {
    const { useCase, getCommand } = makeUseCase("postgres", {
      dbUser: "myuser",
    });
    await useCase.execute({ id: "db-postgres", command: "health" });
    expect(getCommand()).toBe("pg_isready -U myuser");
  });

  test("mysqladmin ping includes password flag when MYSQL_ROOT_PASSWORD is set", async () => {
    const { useCase, getCommand } = makeUseCase("mysql", {
      dbRootPassword: "r00tp@ss",
    });
    await useCase.execute({ id: "db-mysql", command: "health" });
    expect(getCommand()).toContain('-p"r00tp@ss"');
  });

  test("mariadb-admin ping includes password flag when credentials are set", async () => {
    const { useCase, getCommand } = makeUseCase("mariadb", {
      dbRootPassword: "secret",
    });
    await useCase.execute({ id: "db-mariadb", command: "health" });
    expect(getCommand()).toStartWith("mariadb-admin ping");
    expect(getCommand()).toContain('-p"secret"');
  });

  test("redis-cli includes -a flag when password is set", async () => {
    const { useCase, getCommand } = makeUseCase("redis", {
      dbPassword: "s3cur3",
    });
    await useCase.execute({ id: "db-redis", command: "health" });
    expect(getCommand()).toBe(`redis-cli -a "s3cur3" ping`);
  });

  test("mongosh includes -u/-p auth flags when credentials are set", async () => {
    const { useCase, getCommand } = makeUseCase("mongodb", {
      dbUser: "root",
      dbPassword: "mongosecret",
    });
    await useCase.execute({ id: "db-mongodb", command: "health" });
    const cmd = getCommand();
    expect(cmd).toContain(`-u "root"`);
    expect(cmd).toContain(`-p "mongosecret"`);
    expect(cmd).toContain("--authenticationDatabase admin");
    expect(cmd).toContain("db.runCommand({ ping: 1 }).ok");
  });

  // -------------------------------------------------------------------------
  // Error cases
  // -------------------------------------------------------------------------
  test("rejects non-database resources", async () => {
    const useCase = new DatabaseCommandUseCase(
      {
        resourceRepository: {
          findById: async () => ({ id: "app-1", type: "application" }),
        },
      } as unknown as IUnitOfWork,
      {} as never,
    );
    await expect(
      useCase.execute({ id: "app-1", command: "health" }),
    ).rejects.toThrow("only available for database resources");
  });

  test("rejects unsupported database engine", async () => {
    const useCase = new DatabaseCommandUseCase(
      {
        resourceRepository: {
          findById: async () => ({
            id: "db-1",
            type: "database",
            dbType: "oracle",
          }),
        },
      } as unknown as IUnitOfWork,
      {} as never,
    );
    await expect(
      useCase.execute({ id: "db-1", command: "health" }),
    ).rejects.toThrow("Unsupported database engine or command: oracle");
  });

  test("trims trailing newline from command output", async () => {
    const { useCase } = makeUseCase("redis", undefined, () => "PONG\n");
    const result = await useCase.execute({ id: "db-redis", command: "health" });
    expect(result.output).toBe("PONG");
  });
});
