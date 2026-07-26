import { describe, expect, test } from "bun:test";
import type { IUnitOfWork } from "@upstand/domain";
import { ListComposeServicesUseCase } from "./list-compose-services.usecase";

describe("Compose backup service discovery", () => {
  test("returns services from a raw Compose resource", async () => {
    const uow = {
      resourceRepository: {
        findById: async () => ({
          type: "compose",
          credentials: JSON.stringify({
            composeFile:
              "services:\n  database:\n    image: postgres:16\n  web:\n    image: nginx:alpine",
          }),
        }),
      },
    } as unknown as IUnitOfWork;

    await expect(
      new ListComposeServicesUseCase(uow).execute({ resourceId: "resource-1" }),
    ).resolves.toEqual(["database", "web"]);
  });

  test("does not invent services for non-Compose resources", async () => {
    const uow = {
      resourceRepository: {
        findById: async () => ({ type: "application", credentials: null }),
      },
    } as unknown as IUnitOfWork;

    await expect(
      new ListComposeServicesUseCase(uow).execute({ resourceId: "resource-1" }),
    ).resolves.toEqual([]);
  });
});
