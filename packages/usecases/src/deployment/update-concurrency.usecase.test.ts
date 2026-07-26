import { describe, expect, test } from "bun:test";
import { mockUnitOfWork } from "../testing/mock-unit-of-work";
import { UpdateConcurrencyUseCase } from "./update-concurrency.usecase";

describe("UpdateConcurrencyUseCase", () => {
  test("rejects a build-server setting outside the active organization", async () => {
    const useCase = new UpdateConcurrencyUseCase(
      mockUnitOfWork({
        serverRepository: {
          findById: async () => ({ organizationId: "different-org" }),
        },
      }),
    );

    await expect(
      useCase.execute({
        organizationId: "active-org",
        serverId: "remote-server",
        concurrency: 2,
      }),
    ).rejects.toThrow("not part of the active organization");
  });

  test("rejects database servers as build-concurrency targets", async () => {
    const useCase = new UpdateConcurrencyUseCase(
      mockUnitOfWork({
        serverRepository: {
          findById: async () => ({
            organizationId: "active-org",
            serverType: "database",
          }),
        },
      }),
    );

    await expect(
      useCase.execute({
        organizationId: "active-org",
        serverId: "database-server",
        concurrency: 2,
      }),
    ).rejects.toThrow("Database servers cannot be used");
  });
});
