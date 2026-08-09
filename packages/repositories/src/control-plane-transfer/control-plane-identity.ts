import { randomUUID } from "node:crypto";
import { controlPlaneIdentity, type Database } from "@upstand/db";
import { eq } from "drizzle-orm";

/** Returns the durable installation identity shared by PostgreSQL and PGlite. */
export async function getOrCreateControlPlaneInstanceId(
  database: Database,
): Promise<string> {
  const [existing] = await database
    .select({ instanceId: controlPlaneIdentity.instanceId })
    .from(controlPlaneIdentity)
    .where(eq(controlPlaneIdentity.id, "global"))
    .limit(1);
  if (existing) return existing.instanceId;

  const candidate = randomUUID();
  const [created] = await database
    .insert(controlPlaneIdentity)
    .values({ id: "global", instanceId: candidate })
    .onConflictDoNothing({ target: controlPlaneIdentity.id })
    .returning({ instanceId: controlPlaneIdentity.instanceId });
  if (created) return created.instanceId;

  const [raced] = await database
    .select({ instanceId: controlPlaneIdentity.instanceId })
    .from(controlPlaneIdentity)
    .where(eq(controlPlaneIdentity.id, "global"))
    .limit(1);
  if (!raced) throw new Error("Control-plane identity could not be created");
  return raced.instanceId;
}
