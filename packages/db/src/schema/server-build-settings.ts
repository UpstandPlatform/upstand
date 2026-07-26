import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const serverBuildSettings = pgTable("server_build_settings", {
  id: text("id").primaryKey(), // Swarm Node ID or 'local'
  hostname: text("hostname").notNull(),
  ip: text("ip").notNull(),
  concurrency: integer("concurrency").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
