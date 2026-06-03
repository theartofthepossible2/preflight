CREATE TABLE IF NOT EXISTS "stripe_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"receivedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Row Level Security on the new table, matching migrations 0001/0002/0003
-- (hand-written, no FORCE, no policies). The app connects as the table owner,
-- which is exempt from RLS unless FORCE is set, so Drizzle queries keep working;
-- any non-owner role is denied by default (fail-closed defense-in-depth).
ALTER TABLE "stripe_event" ENABLE ROW LEVEL SECURITY;
