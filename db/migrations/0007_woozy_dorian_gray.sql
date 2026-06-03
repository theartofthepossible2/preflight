ALTER TABLE "scan" ADD COLUMN "installationId" integer;--> statement-breakpoint
ALTER TABLE "scan" ADD COLUMN "isPullRequest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scan_baseline_idx" ON "scan" USING btree ("installationId","repo","isPullRequest","createdAt");