import { describe, expect, test } from "bun:test";
import type {
  CreateEnvironmentDTO,
  Environment,
  IEnvironmentRepository,
  UpdateEnvironmentDTO,
} from "@upstand/domain";
import { ValidationError } from "@upstand/domain";
import { mockUnitOfWork } from "../testing/mock-unit-of-work";
import { CreateEnvironmentUseCase } from "./create-environment.usecase";
import { DeleteEnvironmentUseCase } from "./delete-environment.usecase";
import {
  resolveEnvironmentVariables,
  UpdateEnvironmentUseCase,
} from "./update-environment.usecase";

process.env.ENCRYPTION_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

class MockEnvironmentRepository implements IEnvironmentRepository {
  public store: Environment[] = [];
  public ancestorChain: Environment[] = [];

  async findById(id: string): Promise<Environment | null> {
    return this.store.find((e) => e.id === id) || null;
  }

  async findByProjectId(projectId: string): Promise<Environment[]> {
    return this.store.filter((e) => e.projectId === projectId);
  }

  async findAncestors(): Promise<Environment[]> {
    return this.ancestorChain;
  }

  async create(data: CreateEnvironmentDTO): Promise<Environment> {
    const item: Environment = {
      ...data,
      id: data.id ?? `environment-${this.store.length + 1}`,
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
    this.store.push(item);
    return item;
  }

  async updateEnvironment(
    id: string,
    patch: UpdateEnvironmentDTO,
  ): Promise<Environment | null> {
    const index = this.store.findIndex((e) => e.id === id);
    if (index === -1) return null;
    const existing = this.store[index];
    if (!existing) return null;
    this.store[index] = {
      ...existing,
      ...patch,
      updatedAt: new Date(),
    };
    return this.store[index];
  }

  async updateById(
    id: string,
    patch: Partial<CreateEnvironmentDTO>,
  ): Promise<Environment | null> {
    return this.updateEnvironment(id, {
      name: patch.name,
      description: patch.description,
      parentEnvironmentId: patch.parentEnvironmentId,
      inheritsVariables: patch.inheritsVariables,
    });
  }

  async findMany(): Promise<Environment[]> {
    return this.store;
  }

  async createMany(values: CreateEnvironmentDTO[]): Promise<Environment[]> {
    return Promise.all(values.map((value) => this.create(value)));
  }

  async incrementResourceCount(id: string, delta: number): Promise<void> {
    const environment = await this.findById(id);
    if (environment) environment.resourceCount += delta;
  }

  async deleteById(id: string): Promise<boolean> {
    const index = this.store.findIndex((e) => e.id === id);
    if (index > -1) {
      this.store.splice(index, 1);
      return true;
    }
    return false;
  }

  async count(): Promise<number> {
    return this.store.length;
  }
}

describe("Environment Usecases", () => {
  test("creates a new environment with a slugified name", async () => {
    const uow = mockUnitOfWork({
      environmentRepository: new MockEnvironmentRepository(),
    });
    const createUseCase = new CreateEnvironmentUseCase(uow);

    const env = await createUseCase.execute({
      projectId: "project-1",
      name: "Staging Env",
      description: "Temp test environment",
    });

    expect(env.name).toBe("Staging Env");
    expect(env.slug).toBe("staging-env");
    expect(env.isDefault).toBe(false);
    expect(env.isProtected).toBe(false);
  });

  test("updates an existing environment including project env vars", async () => {
    const uow = mockUnitOfWork({
      environmentRepository: new MockEnvironmentRepository(),
    });
    const createUseCase = new CreateEnvironmentUseCase(uow);
    const updateUseCase = new UpdateEnvironmentUseCase(uow);

    const env = await createUseCase.execute({
      projectId: "project-1",
      name: "Development",
      description: "Old description",
    });

    const updated = await updateUseCase.execute({
      id: env.id,
      name: "Dev Env",
      description: "New description",
      envVars: {
        DATABASE_URL: "postgres://db:5432/dev",
        PORT: "8080",
      },
    });

    expect(updated.name).toBe("Dev Env");
    expect(updated.description).toBe("New description");
    expect(updated.envVars).toBeDefined();

    // Check if env vars are serialised/encrypted JSON
    expect(updated.envVars).toBeDefined();
    const parsed = JSON.parse(updated.envVars ?? "{}");
    // Since it's encrypted via serializeResourceEnvironmentVariables, it will be in the encrypted payload format
    expect(parsed.ciphertext).toBeDefined();
    expect(parsed.iv).toBeDefined();
    expect(parsed.authTag).toBeDefined();
  });

  test("resolves inherited variables from the current environment toward its parent", async () => {
    const parent: Environment = {
      id: "parent",
      projectId: "project-1",
      parentEnvironmentId: null,
      inheritsVariables: false,
      name: "Parent",
      slug: "parent",
      description: null,
      isDefault: false,
      isProtected: false,
      resourceCount: 0,
      envVars: JSON.stringify({ PARENT: "parent-value" }),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const child: Environment = {
      id: "child",
      projectId: "project-1",
      parentEnvironmentId: "parent",
      inheritsVariables: false,
      name: "Child",
      slug: "child",
      description: null,
      isDefault: false,
      isProtected: false,
      resourceCount: 0,
      envVars: JSON.stringify({ CHILD: "child-value" }),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const grandchild: Environment = {
      id: "grandchild",
      projectId: "project-1",
      parentEnvironmentId: "child",
      inheritsVariables: true,
      name: "Grandchild",
      slug: "grandchild",
      description: null,
      isDefault: false,
      isProtected: false,
      resourceCount: 0,
      envVars: JSON.stringify({ GRANDCHILD: "grandchild-value" }),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const repository = new MockEnvironmentRepository();
    repository.ancestorChain = [grandchild, child, parent];
    const uow = mockUnitOfWork({ environmentRepository: repository });

    await expect(
      resolveEnvironmentVariables(uow, grandchild.id),
    ).resolves.toEqual({
      GRANDCHILD: "grandchild-value",
      CHILD: "child-value",
    });
  });

  test("prevents deletion of default production environment", async () => {
    const uow = mockUnitOfWork({
      environmentRepository: new MockEnvironmentRepository(),
    });
    const createUseCase = new CreateEnvironmentUseCase(uow);
    const deleteUseCase = new DeleteEnvironmentUseCase(uow);

    const env = await createUseCase.execute({
      projectId: "project-1",
      name: "production",
    });

    // Manually mark it default
    const environment = uow.environmentRepository.store[0];
    if (!environment) throw new Error("Expected created environment");
    environment.isDefault = true;

    expect(deleteUseCase.execute({ id: env.id })).rejects.toThrow(
      ValidationError,
    );
  });

  test("prevents deletion when environment contains resources", async () => {
    const uow = mockUnitOfWork({
      environmentRepository: new MockEnvironmentRepository(),
    });
    const createUseCase = new CreateEnvironmentUseCase(uow);
    const deleteUseCase = new DeleteEnvironmentUseCase(uow);

    const env = await createUseCase.execute({
      projectId: "project-1",
      name: "Development",
    });

    // Manually update resourceCount
    const environment = uow.environmentRepository.store[0];
    if (!environment) throw new Error("Expected created environment");
    environment.resourceCount = 1;

    expect(deleteUseCase.execute({ id: env.id })).rejects.toThrow(
      ValidationError,
    );
  });

  test("deletes empty, non-default environment successfully", async () => {
    const uow = mockUnitOfWork({
      environmentRepository: new MockEnvironmentRepository(),
    });
    const createUseCase = new CreateEnvironmentUseCase(uow);
    const deleteUseCase = new DeleteEnvironmentUseCase(uow);

    const env = await createUseCase.execute({
      projectId: "project-1",
      name: "Staging",
    });

    const success = await deleteUseCase.execute({ id: env.id });
    expect(success).toBe(true);
    expect(uow.environmentRepository.store).toHaveLength(0);
  });
});
