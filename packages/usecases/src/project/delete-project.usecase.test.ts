import { describe, expect, test } from "bun:test";
import type { Environment } from "@upstand/domain";
import { ValidationError } from "@upstand/domain";
import { mockUnitOfWork } from "../testing/mock-unit-of-work";
import { DeleteProjectUseCase } from "./delete-project.usecase";

class MockEnvironmentRepository {
  public store: Array<
    Pick<Environment, "id" | "projectId" | "name" | "resourceCount">
  > = [];

  async findByProjectId(projectId: string) {
    return this.store.filter((e) => e.projectId === projectId);
  }
}

class MockProjectRepository {
  public deletedId: string | null = null;

  async findById(id: string) {
    return {
      id,
      name: "Project",
      organizationId: "org-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async delete(id: string) {
    this.deletedId = id;
    return {
      id,
      name: "Deleted Project",
      organizationId: "org-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}

describe("DeleteProjectUseCase", () => {
  test("prevents deletion of project when resources exist in any environment", async () => {
    const uow = mockUnitOfWork({
      environmentRepository: new MockEnvironmentRepository(),
      projectRepository: new MockProjectRepository(),
    });
    const usecase = new DeleteProjectUseCase(uow);

    // Seed mock environment with resources
    uow.environmentRepository.store.push({
      id: "env-1",
      projectId: "project-1",
      name: "production",
      resourceCount: 1,
    });

    expect(
      usecase.execute({ id: "project-1", organizationId: "org-1" }),
    ).rejects.toThrow(ValidationError);
    expect(uow.projectRepository.deletedId).toBeNull();
  });

  test("deletes project successfully when all environments are empty of resources", async () => {
    const uow = mockUnitOfWork({
      environmentRepository: new MockEnvironmentRepository(),
      projectRepository: new MockProjectRepository(),
    });
    const usecase = new DeleteProjectUseCase(uow);

    // Seed empty mock environment
    uow.environmentRepository.store.push({
      id: "env-1",
      projectId: "project-1",
      name: "production",
      resourceCount: 0,
    });

    const project = await usecase.execute({
      id: "project-1",
      organizationId: "org-1",
    });
    expect(project?.id).toBe("project-1");
    expect(uow.projectRepository.deletedId).toBe("project-1");
  });

  test("does not delete a project from another organization", async () => {
    const uow = mockUnitOfWork({
      environmentRepository: new MockEnvironmentRepository(),
      projectRepository: new MockProjectRepository(),
    });
    const usecase = new DeleteProjectUseCase(uow);

    const project = await usecase.execute({
      id: "project-1",
      organizationId: "org-2",
    });

    expect(project).toBeNull();
    expect(uow.projectRepository.deletedId).toBeNull();
  });
});
