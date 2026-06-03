CREATE TABLE IF NOT EXISTS "scan_job" (
	"id" text PRIMARY KEY NOT NULL,
	"installationId" integer NOT NULL,
	"repoFullName" text NOT NULL,
	"repoId" integer NOT NULL,
	"headSha" text NOT NULL,
	"ref" text NOT NULL,
	"isPullRequest" boolean DEFAULT false NOT NULL,
	"userId" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"checkRunId" integer,
	"lastError" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"claimedAt" timestamp,
	"finishedAt" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scan_job" ADD CONSTRAINT "scan_job_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scan_job_status_created_idx" ON "scan_job" USING btree ("status","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scan_job_repo_sha_idx" ON "scan_job" USING btree ("repoId","headSha");--> statement-breakpoint
-- Row Level Security on the new table, matching migrations 0001–0005 (hand-written, no
-- FORCE, no policies). The app connects as the table owner, which is exempt from RLS
-- unless FORCE is set, so Drizzle queries keep working; any non-owner role is denied by
-- default (fail-closed defense-in-depth).
ALTER TABLE "scan_job" ENABLE ROW LEVEL SECURITY;