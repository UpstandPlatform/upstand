import { describe, expect, test } from "bun:test";
import type { EnvironmentSummaryProjection } from "@upstand/domain";
import { mockUnitOfWork } from "../testing/mock-unit-of-work";
import {
  type GetEnvironmentsInput,
  GetEnvironmentsUseCase,
} from "./get-environments.usecase";

const input: GetEnvironmentsInput = { projectId: "project-1" };

const summary: EnvironmentSummaryProjection = {
  id: "environment-1",
  projectId: "project-1",
  parentEnvironmentId: null,
  inheritsVariables: false,
  name: "Production",
  slug: "production",
  description: null,
  isDefault: true,
  isProtected: true,
  resourceCount: 1,
  envVarsConfigured: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("GetEnvironmentsUseCase", () => {
  test("uses the metadata projection without hydrating environment secrets", async () => {
    let fullReadCalls = 0;
    const uow = mockUnitOfWork({
      environmentRepository: {
        findSummariesByProjectId: async () => [summary],
        findByProjectId: async () => {
          fullReadCalls += 1;
          return [];
        },
      },
    });

    const result = await new GetEnvironmentsUseCase(uow).execute(input);

    expect(result).toEqual([summary]);
    expect(fullReadCalls).toBe(0);
  });
});
