import type { TokenLike } from "@circulo-ai/di";
import type { IUnitOfWork } from "@upstand/domain";
import {
  AssignResourceTagUseCaseToken,
  CreateTagUseCaseToken,
  DeleteTagUseCaseToken,
  ListResourceTagsUseCaseToken,
  ListTagsUseCaseToken,
  RemoveResourceTagUseCaseToken,
  UnitOfWorkToken,
  UpdateTagUseCaseToken,
} from "@upstand/usecases/tokens";
import { z } from "zod";
import {
  resolveUpGalTool,
  type UpGalExecutableTool,
  type UpGalToolFactoryContext,
  upGalMutationTool,
  upGalReadTool,
} from "./factory";
import {
  createTagSchema,
  deleteTagSchema,
  resourceTagMutationSchema,
  resourceTagSchema,
  tagSchema,
  tagsSchema,
  updateTagSchema,
} from "./tag-schemas";

const listTagsInputSchema = z.object({});
const getResourceTagsInputSchema = resourceTagSchema.pick({
  resourceId: true,
});
const deleteTagOutputSchema = z.object({ deleted: z.boolean() });

export type UpGalTagTools = {
  list_tags: UpGalExecutableTool<
    z.infer<typeof listTagsInputSchema>,
    z.infer<typeof tagsSchema>
  >;
  get_resource_tags: UpGalExecutableTool<
    z.infer<typeof getResourceTagsInputSchema>,
    z.infer<typeof tagsSchema>
  >;
  create_tag: UpGalExecutableTool<
    z.infer<typeof createTagSchema>,
    z.infer<typeof tagSchema>
  >;
  update_tag: UpGalExecutableTool<
    z.infer<typeof updateTagSchema>,
    z.infer<typeof tagSchema>
  >;
  delete_tag: UpGalExecutableTool<
    z.infer<typeof deleteTagSchema>,
    z.infer<typeof deleteTagOutputSchema>
  >;
  assign_resource_tag: UpGalExecutableTool<
    z.infer<typeof resourceTagSchema>,
    z.infer<typeof resourceTagMutationSchema>
  >;
  detach_resource_tag: UpGalExecutableTool<
    z.infer<typeof resourceTagSchema>,
    z.infer<typeof resourceTagMutationSchema>
  >;
};

async function assertResourceInOrganization(
  context: UpGalToolFactoryContext,
  resourceId: string,
) {
  const uow = resolveUpGalTool<IUnitOfWork>(context, UnitOfWorkToken);
  const resource = await uow.resourceRepository.findById(resourceId);
  if (!resource) throw new Error("Resource was not found.");
  const environment = await uow.environmentRepository.findById(
    resource.environmentId,
  );
  const project = environment
    ? await uow.projectRepository.findById(environment.projectId)
    : null;
  if (!project || project.organizationId !== context.organizationId) {
    throw new Error("Resource is not part of the active organization.");
  }
  return resource;
}

async function assertTagInOrganization(
  context: UpGalToolFactoryContext,
  tagId: string,
) {
  const tag = await resolveUpGalTool<IUnitOfWork>(
    context,
    UnitOfWorkToken,
  ).tagRepository.findById(tagId);
  if (!tag || tag.organizationId !== context.organizationId) {
    throw new Error("Tag is not part of the active organization.");
  }
  return tag;
}

export function createUpGalTagTools(
  context: UpGalToolFactoryContext,
): UpGalTagTools {
  const run = <T>(token: TokenLike<T>) => resolveUpGalTool(context, token);
  return {
    list_tags: upGalReadTool(
      "Read all reusable tags in the active organization.",
      listTagsInputSchema,
      tagsSchema,
      async () =>
        run(ListTagsUseCaseToken).execute({
          organizationId: context.organizationId,
        }),
    ),
    get_resource_tags: upGalReadTool(
      "Read tags assigned to a resource in the active organization.",
      getResourceTagsInputSchema,
      tagsSchema,
      async ({ resourceId }) => {
        await assertResourceInOrganization(context, resourceId);
        return run(ListResourceTagsUseCaseToken).execute({ resourceId });
      },
    ),
    create_tag: upGalMutationTool(
      "Create a reusable organization tag. This requires approval.",
      createTagSchema,
      tagSchema,
      async (input) =>
        run(CreateTagUseCaseToken).execute({
          ...input,
          organizationId: context.organizationId,
        }),
    ),
    update_tag: upGalMutationTool(
      "Rename or recolor an organization tag. This requires approval.",
      updateTagSchema,
      tagSchema,
      async (input) =>
        run(UpdateTagUseCaseToken).execute({
          ...input,
          organizationId: context.organizationId,
        }),
    ),
    delete_tag: upGalMutationTool(
      "Delete an organization tag. This requires approval.",
      deleteTagSchema,
      deleteTagOutputSchema,
      async ({ id }) =>
        run(DeleteTagUseCaseToken).execute({
          id,
          organizationId: context.organizationId,
        }),
    ),
    assign_resource_tag: upGalMutationTool(
      "Assign an organization tag to a resource. This requires approval.",
      resourceTagSchema,
      resourceTagMutationSchema,
      async (input) => {
        await assertResourceInOrganization(context, input.resourceId);
        await assertTagInOrganization(context, input.tagId);
        return run(AssignResourceTagUseCaseToken).execute(input);
      },
    ),
    detach_resource_tag: upGalMutationTool(
      "Remove an organization tag from a resource. This requires approval.",
      resourceTagSchema,
      resourceTagMutationSchema,
      async (input) => {
        await assertResourceInOrganization(context, input.resourceId);
        await assertTagInOrganization(context, input.tagId);
        return run(RemoveResourceTagUseCaseToken).execute(input);
      },
    ),
  };
}
