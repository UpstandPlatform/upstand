import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const proxyTakeoverJournal = pgTable(
  "proxy_takeover_journal",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id").notNull(),
    previousProxy: text("previous_proxy").notNull(),
    occupiedPorts: jsonb("occupied_ports")
      .$type<number[]>()
      .default([])
      .notNull(),
    stopTargets: jsonb("stop_targets")
      .$type<
        {
          port?: number;
          unit?: string;
          pid?: number;
          container?: string;
          label?: string;
        }[]
      >()
      .default([])
      .notNull(),
    importedSites: jsonb("imported_sites")
      .$type<Record<string, unknown>[]>()
      .default([])
      .notNull(),
    status: text("status").default("planned").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("proxy_takeover_journal_server_idx").on(
      table.serverId,
      table.createdAt,
    ),
  ],
);
