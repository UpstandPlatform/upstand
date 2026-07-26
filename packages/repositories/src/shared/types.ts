import type { DatabaseExecutor, DatabaseTransactionClient } from "@upstand/db";
import type * as schema from "@upstand/db/schema/index";

export type Schema = typeof schema;
export type Transaction = DatabaseTransactionClient;
export type Executor = DatabaseExecutor;
