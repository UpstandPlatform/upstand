CREATE TABLE "edge_country_aggregate" (
	"id" text PRIMARY KEY NOT NULL,
	"route_id" text,
	"bucket_start" timestamp NOT NULL,
	"country_code" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"blocked" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edge_cutover" (
	"id" text PRIMARY KEY NOT NULL,
	"route_id" text,
	"source" text NOT NULL,
	"target" text NOT NULL,
	"status" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edge_installation" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'uninstalled' NOT NULL,
	"detected_proxy" text,
	"management_url" text DEFAULT 'http://127.0.0.1:8090' NOT NULL,
	"geoip_available" boolean DEFAULT false NOT NULL,
	"last_error" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edge_route" (
	"id" text PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"path" text NOT NULL,
	"upstream" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trusted_proxies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edge_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"route_id" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edge_traffic_minute" (
	"id" text PRIMARY KEY NOT NULL,
	"route_id" text,
	"bucket_start" timestamp NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"blocked" integer DEFAULT 0 NOT NULL,
	"status_2xx" integer DEFAULT 0 NOT NULL,
	"status_4xx" integer DEFAULT 0 NOT NULL,
	"status_5xx" integer DEFAULT 0 NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"latency_ms" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edge_workload" (
	"id" text PRIMARY KEY NOT NULL,
	"container_id" text NOT NULL,
	"name" text NOT NULL,
	"image" text NOT NULL,
	"state" text NOT NULL,
	"status" text NOT NULL,
	"ports" text DEFAULT '' NOT NULL,
	"mounts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"networks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"health" text,
	"adopted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "edge_country_route_bucket_idx" ON "edge_country_aggregate" USING btree ("route_id","bucket_start","country_code");--> statement-breakpoint
CREATE UNIQUE INDEX "edge_route_host_path_idx" ON "edge_route" USING btree ("host","path");--> statement-breakpoint
CREATE INDEX "edge_route_host_idx" ON "edge_route" USING btree ("host");--> statement-breakpoint
CREATE INDEX "edge_rule_route_idx" ON "edge_rule" USING btree ("route_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "edge_traffic_route_bucket_idx" ON "edge_traffic_minute" USING btree ("route_id","bucket_start");--> statement-breakpoint
CREATE UNIQUE INDEX "edge_workload_container_idx" ON "edge_workload" USING btree ("container_id");