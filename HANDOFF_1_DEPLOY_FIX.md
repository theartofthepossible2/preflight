# Handoff 1 — Fix the deployed 500 (auth/DB on Vercel)

> **Goal for this chat:** get the deployed site at `https://preflight-seven.vercel.app` working
> end-to-end — visitor can sign in with GitHub and land on `/dashboard` without a 500. Everything
> builds and runs locally; the failure is environment/config on Vercel, not code.

## Current symptom

After completing the GitHub OAuth flow, the deployed site returns a **500** rendered as Auth.js's
generic page: *"Server error — There is a problem with the server configuration."* That page is the
Auth.js **`Configuration`** error. It is emitted server-side when a required secret is missing or an
adapter method throws (e.g. the DB write for the user record fails). It is NOT a client/browser/account
problem — it fires regardless of which GitHub account signs in.

## What's already been done (don't redo)

- The full v0.3 app is built and committed to `main` (`theartofthepossible2/preflight`, commits up to
  the latest push). `npm run build` and `npx tsc --noEmit` pass clean with **zero** env vars set
  (`db/index.ts` and `lib/stripe.ts` were made fail-soft at module load specifically so the Vercel
  build doesn't abort).
- **The Drizzle migration succeeded locally** — `npm run db:migrate` created all tables in Supabase
  (`user`, `account`, `session`, `verificationToken`, `subscription`, `api_key`, `scan`,
  `analysis_cache`). Since local and prod share the same Supabase DB, **prod has the tables too**.
  Migration file: `db/migrations/0000_good_shape.sql`.
- `drizzle.config.ts` was fixed to load `.env.local` via `dotenv` (drizzle-kit doesn't auto-load it).

## The connection-string saga (root of most pain so far)

`DATABASE_URL` must be the Postgres **pooler** connection string. Three wrong forms were tried:

| Value tried | Why it failed |
|---|---|
| `https://ruybgatsvnhipgpnojwg.supabase.co` | That's the **REST API** URL, not Postgres. |
| `postgres://...@ruybgatsvnhipgpnojwg.supabase.co:5432/...` | Bare host = API host; Postgres isn't there → `CONNECT_TIMEOUT`. |
| (correct) `postgres://postgres.ruybgatsvnhipgpnojwg:[PW]@aws-0-[region].pooler.supabase.com:5432/postgres` | **This worked locally.** |

Tells of a correct URL: host contains **`pooler.supabase.com`**, username is
**`postgres.ruybgatsvnhipgpnojwg`** (project-ref-qualified). Do **not** use
`db.ruybgatsvnhipgpnojwg.supabase.co` (IPv6-only — fails on Vercel serverless). Session pooler (5432)
and Transaction pooler (6543) both work; `db/index.ts` sets `prepare: false`.

Supabase project ref: **`ruybgatsvnhipgpnojwg`**.

## Leading hypothesis (start here)

The site fixed locally still 500s because **Vercel uses its own env vars**, and env-var changes only
take effect on a **redeploy**. Most likely one of:
1. `DATABASE_URL` in Vercel is still a wrong value (REST URL or bare host).
2. `DATABASE_URL` was set only for Preview/Development, not **Production**.
3. It was corrected but **not redeployed**.
4. `AUTH_SECRET` / `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` missing for Production.

## Do this, in order

1. **Get the real error.** Either:
   - Vercel Dashboard → project → **Logs** → reproduce the 500 → read the red error line, OR
   - Pull via Vercel MCP. **Note:** the account is a *personal* account (no teams). `list_teams`
     returned empty and the slug `theartofthepossible2` did **not** resolve. Ask the user for the
     exact `<slug>` in their dashboard URL `vercel.com/<slug>/preflight`, then call
     `mcp__claude_ai_Vercel__get_runtime_logs` with that as `teamId` and `statusCode: "500"`.
2. **Verify Vercel env vars** (Settings → Environment Variables), all enabled for **Production**:
   - `DATABASE_URL` = the pooler URL that worked locally
   - `AUTH_SECRET` (generate: `openssl rand -base64 32`)
   - `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`
   - `ANTHROPIC_API_KEY`
   - `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`
   - `PREVIEW_USERNAME`, `PREVIEW_PASSWORD` (basic-auth gate; see `middleware.ts`)
   - Optional: `AUTH_URL=https://preflight-seven.vercel.app`
3. **Redeploy** (Deployments → top → ⋯ → Redeploy). Required after any env change.
4. **GitHub OAuth App** (github.com/settings/developers) callback URL must include
   `https://preflight-seven.vercel.app/api/auth/callback/github` (keep the localhost one too).
5. **Clear cookies** for `preflight-seven.vercel.app` (or use incognito) before retrying — a stale
   session cookie from when `AUTH_SECRET` was unstable can itself cause a decode failure.

## Definition of done

Visit `https://preflight-seven.vercel.app` (through the password gate) → click sign in → authorize on
GitHub → land on `/dashboard` with no 500. Then issue an API key and confirm it appears in the list.

## Useful context

- Stack: Next.js 15 App Router, Auth.js v5 (`next-auth@5.0.0-beta.25`, JWT sessions, Drizzle adapter),
  Supabase Postgres via `postgres` (postgres-js), Drizzle ORM, Stripe, Anthropic SDK.
- Key files: `auth.ts`, `middleware.ts`, `db/{schema,index}.ts`, `app/api/auth/[...nextauth]/route.ts`,
  `app/dashboard/page.tsx`, `lib/{stripe,apiKey}.ts`.
- Project memory (persists across chats) holds the product architecture and the
  Supabase/`.space`-domain decisions — read it before making architectural calls.
- The deployment lives on `preflight-seven.vercel.app` because the original `usepreflight.space`
  domain was flagged by Google Safe Browsing (`.space` TLD reputation). A real `.com`/`.dev`/
  `.security` domain is still an open decision.

---

# Production security gate — Vercel Deployment Checks setup

> Separate from the 500 fix above. These steps make the Preflight scan actually **hold the
> production promotion** on HIGH findings. The gate is built (two workflows committed on the
> `preflight-action` branch) but stays **inert** until the steps below are done.

## How it works (so the steps make sense)

- On a production deploy, Vercel's GitHub integration fires a `repository_dispatch` event
  (`vercel.deployment.success`) at this repo.
- `.github/workflows/vercel-deployment-check.yml` runs the scan and, via
  `vercel/repository-dispatch/actions/status@v1`, sets a **commit status** named
  **`Preflight Security Gate`** on the deployed commit.
- Vercel **does not read GitHub check runs** — it gates on that commit status. The status
  starts `pending`; the job's outcome decides it: `action/report.mjs` exits non-zero on a
  HIGH finding → job fails → status fails → Vercel holds the promotion.
- `preflight.yml` is the separate PR-time check (developer feedback + branch protection);
  it does not gate production.

## Do this, in order

1. **Apply the RLS migration to the prod DB.** New migration
   `db/migrations/0001_solid_steve_rogers.sql` enables Row Level Security on all 8 tables.
   From a shell with the prod pooler `DATABASE_URL` in `.env.local` (drizzle-kit loads it):
   ```
   npm run db:migrate
   ```
   `0000` is already applied (tables exist in prod), so this applies **only** the new RLS
   migration. Safe / non-breaking: RLS is enabled with **no FORCE and no policies**, and the
   app connects as the table owner (owner is exempt from RLS unless FORCE is set), so existing
   Drizzle queries are unaffected. It is fail-closed defense-in-depth — any non-owner role
   (e.g. a Supabase anon/authenticated connection) is denied until a policy is added.
2. **Add the GitHub repo secret** `PREFLIGHT_API_KEY` (repo → Settings → Secrets and variables
   → Actions → New repository secret). Both workflows pass it to `./action`.
3. **Register the check in Vercel.** Project → Settings → **Deployment Checks** (confirm the
   exact location in the current dashboard) → add a check named **exactly**
   `Preflight Security Gate` — it must match the `name:` in `vercel-deployment-check.yml`.
   This is what makes Vercel wait for the status before promoting.
4. **Confirm the integration sends dispatch events.** The Vercel-for-GitHub integration fires
   `vercel.deployment.*` automatically for connected repos; no code change needed. There is no
   documented per-repo toggle — if events never arrive, verify the integration is installed on
   this repo.
5. **Merge `preflight-action` → `main` and push.** `repository_dispatch` only triggers
   workflows that exist on the **default branch**, so the gate is inert until this lands on
   main. (Outstanding "merge to main" step — needs your go-ahead to push.)

## Verify it's live

- Trigger a production deploy (push to main or redeploy). In the repo's **Actions** tab a
  **Preflight Security Gate** run should appear, triggered by `repository_dispatch`.
- On the deployed commit, a `Preflight Security Gate` **commit status** should show
  success/failure. On a HIGH finding, Vercel should hold the promotion.
- **First run:** open the dispatch run's logs and inspect `github.event.client_payload` to
  confirm Vercel's field names (deployment URL / sha / target), in case you later want to scan
  an exact ref or restrict the job to `target == 'production'`. The workflow currently scans
  the default-branch HEAD and runs on every successful deploy.
