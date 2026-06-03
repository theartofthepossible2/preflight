CREATE TABLE IF NOT EXISTS "vercel_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"tokenCipher" text NOT NULL,
	"teamId" text,
	"projectId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vercel_connection" ADD CONSTRAINT "vercel_connection_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vercel_connection_user_idx" ON "vercel_connection" USING btree ("userId");--> statement-breakpoint
-- Row Level Security on the new table, matching migrations 0001/0002/0003/0004
-- (hand-written, no FORCE, no policies). The app connects as the table owner,
-- which is exempt from RLS unless FORCE is set, so Drizzle queries keep working;
-- any non-owner role is denied by default (fail-closed defense-in-depth).
ALTER TABLE "vercel_connection" ENABLE ROW LEVEL SECURITY;