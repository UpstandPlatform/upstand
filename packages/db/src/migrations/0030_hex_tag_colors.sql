UPDATE "tag"
SET "color" = CASE "color"
  WHEN 'primary' THEN '#6366f1'
  WHEN 'emerald' THEN '#10b981'
  WHEN 'amber' THEN '#f59e0b'
  WHEN 'violet' THEN '#8b5cf6'
  WHEN 'rose' THEN '#f43f5e'
  WHEN 'sky' THEN '#0ea5e9'
  WHEN 'slate' THEN '#64748b'
  ELSE '#6366f1'
END
WHERE "color" !~ '^#[0-9a-fA-F]{6}$';--> statement-breakpoint
ALTER TABLE "tag" ALTER COLUMN "color" SET DEFAULT '#6366f1';--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_color_hex_check" CHECK ("color" ~ '^#[0-9a-fA-F]{6}$');
