import type { Pool } from "pg";

/**
 * Better Auth 1.7 added issuer-scoped account identity. The generated
 * migration gives legacy rows a temporary credential issuer so the new
 * required column can be added atomically; normalize non-credential rows to
 * the issuer Better Auth uses for their provider before the server accepts
 * requests.
 */
export async function normalizeLegacyAccountIssuers(
  client: Pick<Pool, "query">,
): Promise<void> {
  const relation = await client.query<{ relation: string | null }>(
    "SELECT to_regclass($1) AS relation",
    ["public.account"],
  );
  if (!relation.rows[0]?.relation) return;

  const column = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'account'
         AND column_name = 'issuer'
     ) AS exists`,
  );
  if (!column.rows[0]?.exists) return;

  await client.query(`
    UPDATE "account"
    SET "issuer" = CASE
      WHEN "provider_id" = 'google' THEN 'https://accounts.google.com'
      ELSE 'local:oauth:' || "provider_id"
    END
    WHERE "provider_id" <> 'credential'
      AND "issuer" = 'local:credential'
  `);
}
