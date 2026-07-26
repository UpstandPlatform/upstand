import { describe, expect, test } from "bun:test";
import type {
  CreateProjectDTO,
  IProjectRepository,
  Project,
  UpdateProjectDTO,
} from "@upstand/domain";
import { mockUnitOfWork } from "../testing/mock-unit-of-work";
import { UpdateProjectUseCase } from "./update-project.usecase";

class MockProjectRepository implements IProjectRepository {
  public projects: Map<string, Project> = new Map();

  async findById(id: string) {
    return this.projects.get(id) ?? null;
  }

  async findMany() {
    return Array.from(this.projects.values());
  }

  async delete(id: string) {
    const p = this.projects.get(id);
    if (p) this.projects.delete(id);
    return p ?? null;
  }

  async create(data: CreateProjectDTO): Promise<Project> {
    const id = data.id ?? `project-${this.projects.size + 1}`;
    const project: Project = {
      ...data,
      id,
      icon: data.icon ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.projects.set(id, project);
    return project;
  }

  async updateById(
    id: string,
    patch: UpdateProjectDTO,
  ): Promise<Project | null> {
    const existing = this.projects.get(id);
    if (!existing) return null;
    const updated: Project = {
      ...existing,
      ...patch,
      updatedAt: new Date(),
    };
    this.projects.set(id, updated);
    return updated;
  }

  async findByOrganizationId(orgId: string) {
    return Array.from(this.projects.values()).filter(
      (p) => p.organizationId === orgId,
    );
  }
}

describe("UpdateProjectUseCase", () => {
  test("updates project icon and name successfully", async () => {
    const repo = new MockProjectRepository();
    await repo.create({
      id: "proj-1",
      name: "Old Name",
      organizationId: "org-1",
    });

    const uow = mockUnitOfWork({ projectRepository: repo });
    const usecase = new UpdateProjectUseCase(uow);

    const result = await usecase.execute({
      id: "proj-1",
      name: "New Name",
      description: "Updated description text",
      icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    });

    expect(result.name).toBe("New Name");
    expect(result.description).toBe("Updated description text");
    expect(result.icon).toBe(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    );
  });

  test("archives and restores a project without deleting it", async () => {
    const repo = new MockProjectRepository();
    await repo.create({
      id: "proj-archive",
      name: "Keep me",
      organizationId: "org-1",
    });
    const usecase = new UpdateProjectUseCase(
      mockUnitOfWork({ projectRepository: repo }),
    );

    const archived = await usecase.execute({
      id: "proj-archive",
      archived: true,
    });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(repo.projects.has("proj-archive")).toBe(true);

    const restored = await usecase.execute({
      id: "proj-archive",
      archived: false,
    });
    expect(restored.archivedAt).toBeNull();
    expect(repo.projects.has("proj-archive")).toBe(true);
  });
});
