type PostgresErrorDetails = {
  code?: unknown;
  constraint?: unknown;
};

export function isPostgresUniqueViolation(
  error: unknown,
  constraint: string,
): boolean {
  if (typeof error !== "object" || error === null) return false;
  const details = error as PostgresErrorDetails;
  return details.code === "23505" && details.constraint === constraint;
}
