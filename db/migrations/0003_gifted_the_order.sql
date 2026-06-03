CREATE TABLE IF NOT EXISTS "rate_limit" (
	"bucketKey" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expiresAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limit_expires_idx" ON "rate_limit" USING btree ("expiresAt");--> statement-breakpoint
-- Row Level Security on the new table, matching migrations 0001/0002 (hand-written,
-- no FORCE, no policies). The app connects as the table owner, which is exempt from
-- RLS unless FORCE is set, so Drizzle queries keep working; any non-owner role is
-- denied by default (fail-closed defense-in-depth).
ALTER TABLE "rate_limit" ENABLE ROW LEVEL SECURITY;