CREATE TABLE IF NOT EXISTS "github_installation" (
	"id" text PRIMARY KEY NOT NULL,
	"installationId" integer NOT NULL,
	"accountLogin" text NOT NULL,
	"accountType" text NOT NULL,
	"userId" text NOT NULL,
	"suspendedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repo_setup" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"installationId" integer NOT NULL,
	"repoFullName" text NOT NULL,
	"repoId" integer,
	"defaultBranch" text,
	"workflowState" text DEFAULT 'pending' NOT NULL,
	"workflowSha" text,
	"secretState" text DEFAULT 'pending' NOT NULL,
	"apiKeyId" text,
	"gateProvider" text DEFAULT 'vercel' NOT NULL,
	"gateState" text DEFAULT 'unverified' NOT NULL,
	"gateLastCheckedAt" timestamp,
	"lastError" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "github_installation" ADD CONSTRAINT "github_installation_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repo_setup" ADD CONSTRAINT "repo_setup_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repo_setup" ADD CONSTRAINT "repo_setup_apiKeyId_api_key_id_fk" FOREIGN KEY ("apiKeyId") REFERENCES "public"."api_key"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "github_installation_installation_idx" ON "github_installation" USING btree ("installationId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_installation_user_idx" ON "github_installation" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repo_setup_user_repo_idx" ON "repo_setup" USING btree ("userId","repoFullName");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repo_setup_user_idx" ON "repo_setup" USING btree ("userId");--> statement-breakpoint
-- Row Level Security on the new tables, matching migration 0001 (hand-written, no
-- FORCE, no policies). The app connects as the table owner, which is exempt from
-- RLS unless FORCE is set, so Drizzle queries keep working; any non-owner role is
-- denied by default (fail-closed defense-in-depth).
ALTER TABLE "github_installation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repo_setup" ENABLE ROW LEVEL SECURITY;