import { z } from "zod";

export const TemplateSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable(),
  tags: z.array(z.string().min(1).max(64)).max(32),
  composeFile: z.string().min(1).max(1_048_576),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Template = z.infer<typeof TemplateSchema>;

export type TemplatePage = {
  items: Template[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export interface CreateTemplateDTO {
  id?: string;
  organizationId: string;
  name: string;
  description?: string | null;
  tags?: string[];
  composeFile: string;
}

export interface ITemplateRepository {
  findById(id: string): Promise<Template | null>;
  findByOrganizationId(
    organizationId: string,
    search?: string,
  ): Promise<Template[]>;
  findPageByOrganizationId(input: {
    organizationId: string;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<TemplatePage>;
  create(data: CreateTemplateDTO): Promise<Template>;
  updateById(
    id: string,
    patch: Partial<CreateTemplateDTO>,
  ): Promise<Template | null>;
  deleteById(id: string): Promise<boolean>;
}
