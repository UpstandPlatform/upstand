import type { IUnitOfWork, Resource } from "@upstand/domain";
import { z } from "zod";
import { getDatabaseEnvironment } from "./database-environment";
import type { DockerCommandService as DockerService } from "./docker-client";
import { resolveDockerServiceForServer } from "./docker-client";

export const DatabaseCommandSchema = z.enum(["health", "version"]);

export const DatabaseCommandInputSchema = z.object({
  id: z.string().min(1, "Resource ID is required"),
  command: DatabaseCommandSchema,
});

export type DatabaseCommandInput = z.infer<typeof DatabaseCommandInputSchema>;
type DatabaseCommand = z.infer<typeof DatabaseCommandSchema>;

function resolveEngineCommand(
  resource: Resource,
  cmd: DatabaseCommand,
): string {
  const dbType = resource.dbType?.toLowerCase() ?? "";
  const dbEnv = getDatabaseEnvironment(resource);

  if (cmd === "health") {
    if (dbType === "postgres") {
      const user = dbEnv.POSTGRES_USER || "postgres";
      const db = dbEnv.POSTGRES_DB;
      return db ? `pg_isready -U ${user} -d ${db}` : `pg_isready -U ${user}`;
    }
    if (dbType === "mysql" || dbType === "mariadb") {
      const user = dbEnv.MYSQL_USER || "root";
      const pass = dbEnv.MYSQL_ROOT_PASSWORD || dbEnv.MYSQL_PASSWORD;
      const passFlag = pass ? ` -p"${pass}"` : "";
      const tool = dbType === "mariadb" ? "mariadb-admin" : "mysqladmin";
      return `${tool} ping${user !== "root" ? ` -u ${user}` : ""}${passFlag}`;
    }
    if (dbType === "mongodb") {
      const user = dbEnv.MONGO_INITDB_ROOT_USERNAME;
      const pass = dbEnv.MONGO_INITDB_ROOT_PASSWORD;
      const auth =
        user && pass
          ? ` -u "${user}" -p "${pass}" --authenticationDatabase admin`
          : "";
      return `mongosh${auth} --quiet --eval 'db.runCommand({ ping: 1 }).ok'`;
    }
    if (dbType === "redis") {
      const pass = dbEnv.REDIS_PASSWORD;
      const auth = pass ? ` -a "${pass}"` : "";
      return `redis-cli${auth} ping`;
    }
    if (dbType === "libsql") {
      return "curl -fsS http://127.0.0.1:8080/health";
    }
  }

  if (cmd === "version") {
    if (dbType === "postgres") return "postgres --version";
    if (dbType === "mysql") return "mysql --version";
    if (dbType === "mariadb") return "mariadb --version";
    if (dbType === "mongodb") return "mongod --version";
    if (dbType === "redis") return "redis-server --version";
    if (dbType === "libsql") return "sqld --version";
  }

  throw new Error(`Unsupported database engine or command: ${dbType}`);
}

export class DatabaseCommandUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly defaultDockerService: DockerService,
  ) {}

  async execute(input: DatabaseCommandInput): Promise<{
    resourceId: string;
    dbType: string;
    command: DatabaseCommand;
    output: string;
  }> {
    const resource = await this.uow.resourceRepository.findById(input.id);
    if (!resource) throw new Error("Resource not found");
    if (resource.type !== "database") {
      throw new Error(
        "Database commands are only available for database resources",
      );
    }

    const dbType = resource.dbType?.toLowerCase() ?? "";
    const command = resolveEngineCommand(resource, input.command);

    const { dockerService, cleanup } = await resolveDockerServiceForServer(
      resource.serverId,
      this.uow,
      this.defaultDockerService,
    );
    try {
      const output = await dockerService.runCommandInResourceContainer(
        resource,
        command,
      );
      return {
        resourceId: resource.id,
        dbType,
        command: input.command,
        output: output.trim().slice(0, 32_000),
      };
    } finally {
      cleanup();
    }
  }
}
