import { ValidationError } from "@upstand/domain";

export const LIBSQL_CONTAINER_PORTS = {
  http: 8080,
  grpc: 5001,
  admin: 5000,
} as const;

export function validateLibsqlSettings(
  dbType: string | undefined,
  grpcPort: number | null | undefined,
  adminPort: number | null | undefined,
  httpPort?: number | null,
): void {
  if (
    (grpcPort === undefined || grpcPort === null) &&
    (adminPort === undefined || adminPort === null) &&
    (httpPort === undefined || httpPort === null)
  ) {
    return;
  }
  if (dbType?.toLowerCase() !== "libsql") {
    throw new ValidationError(
      "libSQL gRPC and admin ports can only be configured for libSQL resources",
    );
  }
  const ports = [
    httpPort ?? LIBSQL_CONTAINER_PORTS.http,
    grpcPort ?? LIBSQL_CONTAINER_PORTS.grpc,
    adminPort ?? LIBSQL_CONTAINER_PORTS.admin,
  ];
  if (new Set(ports).size !== ports.length) {
    throw new ValidationError("libSQL published ports must be distinct");
  }
}
