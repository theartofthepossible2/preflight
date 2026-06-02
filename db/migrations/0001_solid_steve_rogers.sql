-- Enable Row Level Security on every table.
--
-- Maintained as hand-written SQL rather than via db/schema.ts .enableRLS():
-- @auth/drizzle-adapter's table types require the .enableRLS() method to stay
-- present, and calling it strips that method, so declaring RLS in the schema
-- breaks auth.ts at the type level. Keeping it here avoids touching auth.ts.
--
-- No FORCE and no policies: the app connects to Postgres as the table owner,
-- which is exempt from RLS unless FORCE is set, so existing Drizzle queries keep
-- working unchanged. This is fail-closed defense-in-depth — any non-owner role
-- (e.g. a Supabase anon/authenticated connection) is denied until a policy is
-- added. Per-user policies are intentionally omitted: authorization is enforced
-- in the app layer (Auth.js), and there is no JWT claim source in-database.
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analysis_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_key" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scan" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscription" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "verificationToken" ENABLE ROW LEVEL SECURITY;
