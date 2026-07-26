import { randomUUID } from "node:crypto";
import {
  DEFAULT_TAG_COLOR,
  type IUnitOfWork,
  type Tag,
  TagColorSchema,
} from "@upstand/domain";
import { z } from "zod";

export const ListTagsInputSchema = z.object({
  organizationId: z.string().min(1),
});
export const CreateTagInputSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().trim().min(1).max(64),
  color: TagColorSchema.default(DEFAULT_TAG_COLOR),
});
export const UpdateTagInputSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string().trim().min(1).max(64).optional(),
  color: TagColorSchema.optional(),
});
export const DeleteTagInputSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});
export const ResourceTagsInputSchema = z.object({
  resourceId: z.string().min(1),
});
export const AssignResourceTagInputSchema = z.object({
  resourceId: z.string().min(1),
  tagId: z.string().min(1),
});

export class ListTagsUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  execute(input: z.infer<typeof ListTagsInputSchema>) {
    return this.uow.tagRepository.findByOrganizationId(input.organizationId);
  }
}

export class CreateTagUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  execute(input: z.infer<typeof CreateTagInputSchema>): Promise<Tag> {
    return this.uow.tagRepository.create({ id: randomUUID(), ...input });
  }
}

export class UpdateTagUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  async execute(input: z.infer<typeof UpdateTagInputSchema>): Promise<Tag> {
    const current = await this.uow.tagRepository.findById(input.id);
    if (!current || current.organizationId !== input.organizationId) {
      throw new Error("Tag not found");
    }
    const updated = await this.uow.tagRepository.updateById(input.id, {
      name: input.name,
      color: input.color,
    });
    if (!updated) throw new Error("Tag not found");
    return updated;
  }
}

export class DeleteTagUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  async execute(input: z.infer<typeof DeleteTagInputSchema>) {
    const current = await this.uow.tagRepository.findById(input.id);
    if (!current || current.organizationId !== input.organizationId) {
      throw new Error("Tag not found");
    }
    await this.uow.tagRepository.deleteById(input.id);
    return { deleted: true };
  }
}

export class ListResourceTagsUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  execute(input: z.infer<typeof ResourceTagsInputSchema>) {
    return this.uow.tagRepository.findByResourceId(input.resourceId);
  }
}

export class AssignResourceTagUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  async execute(input: z.infer<typeof AssignResourceTagInputSchema>) {
    const resource = await this.uow.resourceRepository.findById(
      input.resourceId,
    );
    const tag = await this.uow.tagRepository.findById(input.tagId);
    if (!resource || !tag) throw new Error("Resource or tag not found");
    const environment = await this.uow.environmentRepository.findById(
      resource.environmentId,
    );
    const project = environment
      ? await this.uow.projectRepository.findById(environment.projectId)
      : null;
    if (!project || project.organizationId !== tag.organizationId) {
      throw new Error("Resource and tag must belong to the same organization");
    }
    await this.uow.tagRepository.attachToResource(
      input.resourceId,
      input.tagId,
    );
    return { assigned: true };
  }
}

export class RemoveResourceTagUseCase {
  constructor(private readonly uow: IUnitOfWork) {}
  async execute(input: z.infer<typeof AssignResourceTagInputSchema>) {
    await this.uow.tagRepository.detachFromResource(
      input.resourceId,
      input.tagId,
    );
    return { removed: true };
  }
}
