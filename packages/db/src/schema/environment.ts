import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { project } from "./project";

export const environment = pgTable(
  "environment",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    parentEnvironmentId: text("parent_environment_id"),
    inheritsVariables: boolean("inherits_variables").default(false).notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    isDefault: boolean("is_default").default(false).notNull(),
    isProtected: boolean("is_protected").default(false).notNull(),
    resourceCount: integer("resource_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("environment_project_idx").on(table.projectId),
    index("environment_parent_idx").on(table.parentEnvironmentId),
    uniqueIndex("environment_project_slug_uidx").on(
      table.projectId,
      table.slug,
    ),
  ],
);

/**
 * Stores encrypted project-level environment variables for an environment.
 * Variables are accessible to all resources inside the environment and can be
 * referenced using the ${{project.VARIABLE_NAME}} syntax in resource env vars.
 * This mirrors the resource_secret table pattern: one encrypted JSON document
 * per environment, lazily created on first write.
 */
export const environmentSecret = pgTable("environment_secret", {
  environmentId: text("environment_id")
    .primaryKey()
    .references(() => environment.id, { onDelete: "cascade" }),
  version: integer("version").default(1).notNull(),
  envVars: text("env_vars").notNull().default("{}"),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const environmentRelations = relations(environment, ({ one }) => ({
  project: one(project, {
    fields: [environment.projectId],
    references: [project.id],
  }),
  parent: one(environment, {
    fields: [environment.parentEnvironmentId],
    references: [environment.id],
    relationName: "environment_parent",
  }),
  secrets: one(environmentSecret, {
    fields: [environment.id],
    references: [environmentSecret.environmentId],
  }),
}));

export const environmentSecretRelations = relations(
  environmentSecret,
  ({ one }) => ({
    environment: one(environment, {
      fields: [environmentSecret.environmentId],
      references: [environment.id],
    }),
  }),
);
