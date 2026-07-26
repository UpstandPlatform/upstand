import { count as countRows, eq, type SQL } from "drizzle-orm";
import type {
  PgColumn,
  PgInsertValue,
  PgTable,
  PgUpdateSetSource,
} from "drizzle-orm/pg-core";

import type { Executor } from "./types";

export type TableWithId = PgTable & { id: PgColumn };
export type OrderByArg = PgColumn | SQL | SQL.Aliased;

export interface ListOptions {
  where?: SQL;
  orderBy?: OrderByArg | OrderByArg[];
  limit?: number;
  offset?: number;
}

export interface PageRequest {
  limit?: number;
  offset?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface IRepository<TSelect, TInsert> {
  findById(id: string): Promise<TSelect | null>;
  findMany(options?: ListOptions): Promise<TSelect[]>;
  create(values: TInsert): Promise<TSelect>;
  createMany(values: TInsert[]): Promise<TSelect[]>;
  updateById(id: string, patch: Partial<TInsert>): Promise<TSelect | null>;
  deleteById(id: string): Promise<boolean>;
  deleteByIdReturning(id: string): Promise<TSelect | null>;
  count(where?: SQL): Promise<number>;
}

const DEFAULT_PAGE_LIMIT = 50;

export abstract class BaseRepository<
  TTable extends TableWithId,
  TSelect = TTable["$inferSelect"],
  TInsert = TTable["$inferInsert"],
> implements IRepository<TSelect, TInsert>
{
  protected constructor(
    protected readonly executor: Executor,
    protected readonly table: TTable,
  ) {}

  protected get entity(): PgTable {
    return this.table;
  }

  protected get pk(): PgColumn {
    return this.table.id;
  }

  protected rows(result: unknown): TSelect[] {
    return result as TSelect[];
  }

  protected insertValues(values: TInsert): PgInsertValue<PgTable> {
    return values as unknown as PgInsertValue<PgTable>;
  }

  protected updatePatch(patch: Partial<TInsert>): PgUpdateSetSource<PgTable> {
    return patch as unknown as PgUpdateSetSource<PgTable>;
  }

  async findById(id: string): Promise<TSelect | null> {
    return this.findOne(eq(this.pk, id));
  }

  protected async findOne(where: SQL | undefined): Promise<TSelect | null> {
    const [row] = this.rows(
      await this.executor.select().from(this.entity).where(where).limit(1),
    );
    return row ?? null;
  }

  async findMany(options: ListOptions = {}): Promise<TSelect[]> {
    const query = this.executor.select().from(this.entity).$dynamic();

    if (options.where) {
      query.where(options.where);
    }
    if (options.orderBy) {
      const ordering = Array.isArray(options.orderBy)
        ? options.orderBy
        : [options.orderBy];
      query.orderBy(...ordering);
    }
    if (typeof options.limit === "number") {
      query.limit(options.limit);
    }
    if (typeof options.offset === "number") {
      query.offset(options.offset);
    }

    return this.rows(await query);
  }

  protected async findPage(
    options: ListOptions & PageRequest = {},
  ): Promise<Page<TSelect>> {
    const limit = options.limit ?? DEFAULT_PAGE_LIMIT;
    const offset = options.offset ?? 0;

    const [items, total] = await Promise.all([
      this.findMany({ ...options, limit, offset }),
      this.count(options.where),
    ]);

    return { items, total, limit, offset };
  }

  async create(values: TInsert): Promise<TSelect> {
    const [row] = this.rows(
      await this.executor
        .insert(this.entity)
        .values(this.insertValues(values))
        .returning(),
    );
    if (!row) {
      throw new Error("create: insert returned no rows");
    }
    return row;
  }

  async createMany(values: TInsert[]): Promise<TSelect[]> {
    if (values.length === 0) {
      return [];
    }
    return this.rows(
      await this.executor
        .insert(this.entity)
        .values(values.map((value) => this.insertValues(value)))
        .returning(),
    );
  }

  async updateById(
    id: string,
    patch: Partial<TInsert>,
  ): Promise<TSelect | null> {
    const [row] = this.rows(
      await this.executor
        .update(this.entity)
        .set(this.updatePatch(patch))
        .where(eq(this.pk, id))
        .returning(),
    );
    return row ?? null;
  }

  async deleteById(id: string): Promise<boolean> {
    const deleted = await this.executor
      .delete(this.entity)
      .where(eq(this.pk, id))
      .returning({ id: this.pk });
    return deleted.length > 0;
  }

  async deleteByIdReturning(id: string): Promise<TSelect | null> {
    const [row] = this.rows(
      await this.executor
        .delete(this.entity)
        .where(eq(this.pk, id))
        .returning(),
    );
    return row ?? null;
  }

  protected async deleteMany(where: SQL): Promise<number> {
    const deleted = await this.executor
      .delete(this.entity)
      .where(where)
      .returning({ id: this.pk });
    return deleted.length;
  }

  async count(where?: SQL): Promise<number> {
    const query = this.executor
      .select({ value: countRows() })
      .from(this.entity)
      .$dynamic();
    if (where) {
      query.where(where);
    }
    const [row] = await query;
    return row?.value ?? 0;
  }

  protected async exists(where: SQL): Promise<boolean> {
    return (await this.count(where)) > 0;
  }
}
