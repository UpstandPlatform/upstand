import { describe, expect, test } from "bun:test";
import type {
  CreateEnvironmentDTO,
  CreateProjectDTO,
  Environment,
  IEnvironmentRepository,
  IProjectRepository,
  IUserRepository,
  Project,
  UpdateProjectDTO,
} from "@upstand/domain";
import { mockUnitOfWork } from "../testing/mock-unit-of-work";
import { CreateProjectUseCase } from "./create-project.usecase";

class MockEnvironmentRepository implements IEnvironmentRepository {
  public created: CreateEnvironmentDTO[] = [];

  async findById() {
    return null;
  }

  async findByProjectId() {
    return [];
  }

  async create(data: CreateEnvironmentDTO): Promise<Environment> {
    this.created.push(data);
    return {
      id: data.id ?? `environment-${this.created.length}`,
      projectId: data.projectId,
      parentEnvironmentId: data.parentEnvironmentId ?? null,
      inheritsVariables: data.inheritsVariables ?? false,
      name: data.name,
      slug: data.slug,
      description: data.description ?? null,
      isDefault: data.isDefault ?? false,
      isProtected: data.isProtected ?? false,
      resourceCount: data.resourceCount ?? 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async findMany() {
    return [];
  }

  async createMany() {
    return [];
  }

  async updateById() {
    return null;
  }

  async updateEnvironment() {
    return null;
  }

  async incrementResourceCount() {}

  async deleteById() {
    return false;
  }

  async count() {
    return 0;
  }
}

class MockProjectRepository implements IProjectRepository {
  public created: CreateProjectDTO[] = [];

  async findById() {
    return null;
  }

  async findMany() {
    return [];
  }

  async delete(_id: string) {
    return null;
  }

  async create(data: CreateProjectDTO): Promise<Project> {
    this.created.push(data);
    return {
      id: data.id ?? `project-${this.created.length}`,
      name: data.name,
      description: data.description ?? null,
      organizationId: data.organizationId,
      icon: data.icon ?? null,
      archivedAt: data.archivedAt ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async updateById(_id: string, _patch: UpdateProjectDTO) {
    return null;
  }

  async findByOrganizationId() {
    return [];
  }
}

describe("CreateProjectUseCase", () => {
  test("creates a protected production environment for a new project", async () => {
    const uow = mockUnitOfWork({
      projectRepository: new MockProjectRepository(),
      environmentRepository: new MockEnvironmentRepository(),
      userRepository: (() => {
        const repository: IUserRepository = {
          findById: async () => null,
          findByEmail: async () => null,
          count: async () => 0,
          create: async (data) => ({
            id: data.id ?? "user-1",
            name: data.name,
            email: data.email,
            emailVerified: data.emailVerified ?? false,
            image: data.image ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        };
        return repository;
      })(),
    });
    const usecase = new CreateProjectUseCase(uow);

    await usecase.execute({
      name: "Payments",
      description: "Payment gateway microservices",
      organizationId: "org-1",
    });

    expect(uow.projectRepository.created).toHaveLength(1);
    expect(uow.projectRepository.created[0]).toMatchObject({
      name: "Payments",
      description: "Payment gateway microservices",
      organizationId: "org-1",
    });
    expect(uow.environmentRepository.created).toHaveLength(1);
    expect(uow.environmentRepository.created[0]).toMatchObject({
      name: "production",
      slug: "production",
      isDefault: true,
      isProtected: true,
      resourceCount: 0,
    });
  });
});
