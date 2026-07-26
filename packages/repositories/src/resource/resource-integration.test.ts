import { describe, expect, test } from "bun:test";
import { db, environment, organization, project, resource } from "@upstand/db";
import { eq } from "drizzle-orm";
import { DrizzleUnitOfWork } from "../drizzle-unit-of-work";

process.env.ENCRYPTION_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

describe("Drizzle Resource Repository Integration Tests", () => {
  test("performs full resource lifecycle CRUD operations inside database transaction", async () => {
    if (!process.env.RUN_INTEGRATION_TESTS) {
      return;
    }
    const uow = new DrizzleUnitOfWork(db);
    const orgId = `org-test-${Date.now()}`;
    const projId = `proj-test-${Date.now()}`;
    const envId = `env-test-${Date.now()}`;
    const resId = `res-test-${Date.now()}`;
    const appName = `integration-app-${Date.now()}`;

    try {
      await db.insert(organization).values({
        id: orgId,
        name: "Integration Test Org",
        slug: `org-test-slug-${Date.now()}`,
        createdAt: new Date(),
      });

      await db.insert(project).values({
        id: projId,
        organizationId: orgId,
        name: "Integration Test Project",
        createdAt: new Date(),
      });

      await db.insert(environment).values({
        id: envId,
        projectId: projId,
        name: "Staging Environment",
        slug: `staging-slug-${Date.now()}`,
        createdAt: new Date(),
      });

      const created = await uow.transaction(async (tx) => {
        return tx.resourceRepository.create({
          id: resId,
          environmentId: envId,
          name: "Integration Test Web App",
          appName,
          type: "application",
          provider: "github",
          status: "stopped",
        });
      });

      expect(created.id).toBe(resId);
      expect(created.appName).toBe(appName);
      expect(created.status).toBe("stopped");

      const found = await uow.resourceRepository.findById(resId);
      expect(found).not.toBeNull();
      expect(found?.name).toBe("Integration Test Web App");
      if (!found) throw new Error("Resource was not created");

      const compareAndSetUpdated =
        await uow.resourceRepository.updateByIdIfUpdatedAt(
          resId,
          found.updatedAt,
          { description: "Updated with millisecond-safe compare-and-set" },
        );
      expect(compareAndSetUpdated?.description).toBe(
        "Updated with millisecond-safe compare-and-set",
      );

      const duplicate =
        await uow.resourceRepository.checkDuplicateServiceKey(appName);
      expect(duplicate).not.toBeNull();
      expect(duplicate?.id).toBe(resId);

      const updated = await uow.resourceRepository.updateById(resId, {
        status: "running",
        description: "Updated during integration testing",
      });

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe("running");

      const deleted = await uow.resourceRepository.deleteById(resId);
      expect(deleted).toBe(true);
    } finally {
      await db
        .delete(resource)
        .where(eq(resource.id, resId))
        .catch(() => {});
      await db
        .delete(environment)
        .where(eq(environment.id, envId))
        .catch(() => {});
      await db
        .delete(project)
        .where(eq(project.id, projId))
        .catch(() => {});
      await db
        .delete(organization)
        .where(eq(organization.id, orgId))
        .catch(() => {});
    }
  });

  test("handles atomic environment resource count increments and decrements", async () => {
    if (!process.env.RUN_INTEGRATION_TESTS) {
      return;
    }
    const uow = new DrizzleUnitOfWork(db);
    const orgId = `org-test-cnt-${Date.now()}`;
    const projId = `proj-test-cnt-${Date.now()}`;
    const envId = `env-test-cnt-${Date.now()}`;

    try {
      await db.insert(organization).values({
        id: orgId,
        name: "Count Test Org",
        slug: `org-cnt-slug-${Date.now()}`,
        createdAt: new Date(),
      });
      await db.insert(project).values({
        id: projId,
        organizationId: orgId,
        name: "Count Test Project",
        createdAt: new Date(),
      });
      await db.insert(environment).values({
        id: envId,
        projectId: projId,
        name: "Production Environment",
        slug: `prod-slug-${Date.now()}`,
        createdAt: new Date(),
      });

      await uow.environmentRepository.incrementResourceCount(envId, 1);
      const envAfterInc = await uow.environmentRepository.findById(envId);
      expect(envAfterInc?.resourceCount).toBe(1);

      await uow.environmentRepository.incrementResourceCount(envId, -1);
      const envAfterDec = await uow.environmentRepository.findById(envId);
      expect(envAfterDec?.resourceCount).toBe(0);
    } finally {
      await db
        .delete(environment)
        .where(eq(environment.id, envId))
        .catch(() => {});
      await db
        .delete(project)
        .where(eq(project.id, projId))
        .catch(() => {});
      await db
        .delete(organization)
        .where(eq(organization.id, orgId))
        .catch(() => {});
    }
  });
});
