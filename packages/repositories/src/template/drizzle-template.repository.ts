import { randomUUID } from "node:crypto";
import { template } from "@upstand/db";
import {
  type CreateTemplateDTO,
  type ITemplateRepository,
  type Template,
  type TemplatePage,
  TemplateSchema,
} from "@upstand/domain";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { BaseRepository } from "../shared/base.repository";
import type { Executor } from "../shared/types";

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function toTemplate(row: Template | typeof template.$inferSelect): Template {
  const tags = typeof row.tags === "string" ? parseTags(row.tags) : row.tags;
  return TemplateSchema.parse({ ...row, tags });
}

export class DrizzleTemplateRepository
  extends BaseRepository<typeof template, Template, CreateTemplateDTO>
  implements ITemplateRepository
{
  constructor(executor: Executor) {
    super(executor, template);
  }

  async findById(id: string): Promise<Template | null> {
    const row = await super.findById(id);
    return row ? toTemplate(row) : null;
  }

  async findByOrganizationId(
    organizationId: string,
    search?: string,
  ): Promise<Template[]> {
    const where = search
      ? and(
          eq(template.organizationId, organizationId),
          or(
            ilike(template.name, `%${search}%`),
            ilike(template.description, `%${search}%`),
            ilike(template.tags, `%${search}%`),
          ),
        )
      : eq(template.organizationId, organizationId);
    const rows = await this.executor
      .select()
      .from(template)
      .where(where)
      .orderBy(asc(template.name));
    return rows.map(toTemplate);
  }

  async findPageByOrganizationId(input: {
    organizationId: string;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<TemplatePage> {
    const where = input.search
      ? and(
          eq(template.organizationId, input.organizationId),
          or(
            ilike(template.name, `%${input.search}%`),
            ilike(template.description, `%${input.search}%`),
            ilike(template.tags, `%${input.search}%`),
          ),
        )
      : eq(template.organizationId, input.organizationId);
    const offset = (input.page - 1) * input.pageSize;
    const [rows, total] = await Promise.all([
      this.executor
        .select()
        .from(template)
        .where(where)
        .orderBy(asc(template.name))
        .limit(input.pageSize)
        .offset(offset),
      this.count(where),
    ]);
    return {
      items: rows.map(toTemplate),
      total,
      page: input.page,
      pageSize: input.pageSize,
      pageCount: Math.max(1, Math.ceil(total / input.pageSize)),
    };
  }

  async create(data: CreateTemplateDTO): Promise<Template> {
    const row = await super.create({
      ...data,
      id: data.id ?? randomUUID(),
      tags: JSON.stringify(data.tags ?? []),
    } as unknown as CreateTemplateDTO);
    return toTemplate(row);
  }

  async updateById(
    id: string,
    patch: Partial<CreateTemplateDTO>,
  ): Promise<Template | null> {
    const row = await super.updateById(id, {
      ...patch,
      ...(patch.tags ? { tags: JSON.stringify(patch.tags) } : {}),
    } as unknown as Partial<CreateTemplateDTO>);
    return row ? toTemplate(row) : null;
  }

  deleteById(id: string): Promise<boolean> {
    return super.deleteById(id);
  }
}
