import type {
  AIFeature,
  AIProvider,
  JsonObject,
  JsonValue,
} from "@upstand/domain";
import { relations } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

export const aiProviderConfig = pgTable(
  "ai_provider_config",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Default"),
    provider: text("provider").$type<AIProvider>().notNull(),
    model: text("model").notNull(),
    baseUrl: text("base_url"),
    temperature: real("temperature"),
    reasoningEnabled: integer("reasoning_enabled").notNull().default(0),
    maxOutputTokens: integer("max_output_tokens"),
    apiKeyCiphertext: text("api_key_ciphertext"),
    apiKeyIv: text("api_key_iv"),
    apiKeyAuthTag: text("api_key_auth_tag"),
    apiKeyVersion: integer("api_key_version"),
    enabled: integer("enabled").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ai_provider_config_org_id_uidx").on(
      table.organizationId,
      table.id,
    ),
    index("ai_provider_config_org_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const aiFeatureAssignment = pgTable(
  "ai_feature_assignment",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    feature: text("feature").$type<AIFeature>().notNull(),
    providerConfigId: text("provider_config_id")
      .notNull()
      .references(() => aiProviderConfig.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ai_feature_assignment_org_feature_uidx").on(
      table.organizationId,
      table.feature,
    ),
    index("ai_feature_assignment_org_idx").on(table.organizationId),
    foreignKey({
      columns: [table.organizationId, table.providerConfigId],
      foreignColumns: [aiProviderConfig.organizationId, aiProviderConfig.id],
      name: "ai_feature_assignment_org_provider_config_fk",
    }).onDelete("cascade"),
  ],
);

export const aiConversation = pgTable(
  "ai_conversation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New UpGal conversation"),
    context: jsonb("context").$type<JsonObject>(),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ai_conversation_org_id_uidx").on(
      table.organizationId,
      table.id,
    ),
    index("ai_conversation_org_idx").on(table.organizationId, table.updatedAt),
    index("ai_conversation_org_user_idx").on(
      table.organizationId,
      table.userId,
      table.updatedAt,
    ),
  ],
);

export const aiMessage = pgTable(
  "ai_message",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => aiConversation.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    parts: jsonb("parts").$type<JsonValue[]>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("ai_message_conversation_idx").on(
      table.conversationId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const aiRun = pgTable(
  "ai_run",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => aiConversation.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("running"),
    model: text("model").notNull(),
    stepCount: integer("step_count").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    uniqueIndex("ai_run_org_id_uidx").on(table.organizationId, table.id),
    index("ai_run_conversation_idx").on(table.conversationId, table.startedAt),
    foreignKey({
      columns: [table.organizationId, table.conversationId],
      foreignColumns: [aiConversation.organizationId, aiConversation.id],
      name: "ai_run_org_conversation_fk",
    }).onDelete("cascade"),
  ],
);

export const aiApproval = pgTable(
  "ai_approval",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => aiRun.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => aiConversation.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    toolCallId: text("tool_call_id").notNull(),
    toolName: text("tool_name").notNull(),
    input: jsonb("input").$type<JsonObject>().notNull(),
    status: text("status").notNull().default("pending"),
    decidedBy: text("decided_by").references(() => user.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ai_approval_tool_call_uidx").on(table.runId, table.toolCallId),
    index("ai_approval_org_idx").on(table.organizationId, table.status),
    foreignKey({
      columns: [table.organizationId, table.runId],
      foreignColumns: [aiRun.organizationId, aiRun.id],
      name: "ai_approval_org_run_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.conversationId],
      foreignColumns: [aiConversation.organizationId, aiConversation.id],
      name: "ai_approval_org_conversation_fk",
    }).onDelete("cascade"),
  ],
);

export const aiRelations = relations(aiConversation, ({ many }) => ({
  messages: many(aiMessage),
  runs: many(aiRun),
}));

export const aiProviderConfigRelations = relations(
  aiProviderConfig,
  ({ many }) => ({
    featureAssignments: many(aiFeatureAssignment),
  }),
);

export const aiFeatureAssignmentRelations = relations(
  aiFeatureAssignment,
  ({ one }) => ({
    providerConfig: one(aiProviderConfig, {
      fields: [aiFeatureAssignment.providerConfigId],
      references: [aiProviderConfig.id],
    }),
  }),
);

export const aiTavilySettings = pgTable("ai_tavily_settings", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  enabled: integer("enabled").notNull().default(0),
  apiKeyCiphertext: text("api_key_ciphertext"),
  apiKeyIv: text("api_key_iv"),
  apiKeyAuthTag: text("api_key_auth_tag"),
  apiKeyVersion: integer("api_key_version"),
  searchDepth: text("search_depth").notNull().default("basic"),
  includeAnswer: integer("include_answer").notNull().default(0),
  maxResults: integer("max_results").notNull().default(5),
  enableSearch: integer("enable_search").notNull().default(1),
  enableExtract: integer("enable_extract").notNull().default(0),
  enableCrawl: integer("enable_crawl").notNull().default(0),
  enableMap: integer("enable_map").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
