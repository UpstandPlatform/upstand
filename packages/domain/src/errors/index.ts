export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class EntityNotFoundError extends DomainError {
  constructor(entity: string, query: string) {
    super(`${entity} not found matching query: ${query}`, "ENTITY_NOT_FOUND");
    this.name = "EntityNotFoundError";
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, "CONFLICT");
    this.name = "ConflictError";
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = "Unauthorized access") {
    super(message, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "Forbidden access") {
    super(message, "FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

export type OperationalErrorCode =
  | "EXTERNAL_SERVICE"
  | "CONFIGURATION"
  | "AUTHENTICATION"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "PERMISSION"
  | "NETWORK"
  | "SSH"
  | "DOCKER"
  | "GIT"
  | "NOTIFICATION";

export class OperationalError extends Error {
  constructor(
    message: string,
    public readonly code: OperationalErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OperationalError";
  }
}
