# Preflight — Agent Handoff

> **For:** a fresh agent (Cowork or otherwise) picking up this repo cold.
> **Authored:** 2026-06-02, from a full build/test/runtime verification pass.
> **Companion doc:** `FULL_SCOPE_BRIEF.md` — the deep execution brief (architecture, the four
> workstreams A–D, operator actions). This file is the *current-state entry point*; read it first,
> then go to the brief for depth. Both are untracked working docs — do not commit them.

---

## 0. TL;DR

Preflight is a **deterministic security-gate** that runs as a GitHub Action and blocks Vercel
production deploys on HIGH findings. A paid SaaS ($29/mo flat) wraps it: GitHub-App one-click connect,
a backend that enriches findings, Stripe billing, a Next.js dashboard.

**The product works right now.** Build, typecheck, tests, the scanner gate, and fail-soft runtime are
all green (verified this session — see §2). What remains is hardening + the launch punch-list, not
fixing a broken build. Five non-blocking issues were found; one (Edge/auth) is worth doing early.

---

## 1. Architecture on one screen

```
Customer connects repo (GitHub App)  ─►  workflow file + PREFLIGHT_API_KEY secret written to repo
Vercel finishes a production build    ─►  repository_dispatch: vercel.deployment.success
GitHub Action runs in CUSTOMER's CI   ─►  preflight.mjs scans checked-out code (LOCAL decision)
        └─► best-effort POST /api/enrich (Bearer pflt_…) for explanations (degrades if backend down)
Action posts a GitHub check run named `preflight` (pass/fail from LOCAL findings)
Vercel Deployment Checks auto-discovers `preflight` by name  ─►  gates Production promotion
```

**Key invariant:** the gate decision is made **locally in the Action**, never by our backend. A backend
outage or lapsed subscription can never let a HIGH finding pass — enrichment just degrades. Preserve this.

**Stack:** Next.js 15 App Router · TypeScript · Drizzle ORM · Supabase Postgres · Auth.js v5-beta ·
Stripe · Anthropic SDK (enrichment, invisible). Host: `preflight-seven.vercel.app`.

**Two GitHub identities — never conflate:** sign-in OAuth app (`auth.ts`, identity only) vs. the scoped
GitHub App (`lib/github/app.ts`, repo automation for one-click connect).

---

## 2. Verified current state (2026-06-02)

**Green — confirmed working this session:**

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | clean, 0 errors |
| Production build | `npm run build` | passes **with env and with zero env**; 17 routes |
| Test suite | `npm test` | scanner CLI↔TS parity passes; vulnerable=17 findings, secure=0; all 8 checks A–H fire |
| Scanner gate (the product) | `node preflight.mjs <dir>` | exits **1** on HIGH, **0** when clean; repo self-scan = 0 HIGH |
| Fail-soft runtime | `npm start` zero-env | `/`, `/signin`, `/install`, `/privacy`, `/terms` → 200; `/dashboard` → 307 redirect to signin |

Note: the scanner is now **8 checks** (A–H), `lib/cache.ts` exists, and customer-facing copy is
grep-clean of AI/secure/compliant — several `FULL_SCOPE_BRIEF.md` blockers are already resolved.

**Issues found (none block "it works"), prioritized:**

1. **[Medium] Postgres driver leaks into the Edge middleware bundle.** `middleware.ts` imports `auth`
   from `auth.ts`, which wires `DrizzleAdapter(db)` → `postgres` → Node `net`. A *clean* build
   (`rm -rf .next && npm run build`) warns: `A Node.js module is loaded ('net') ... not supported in the
   Edge Runtime`. It builds and runs today only because the session strategy is JWT (the adapter isn't
   exercised in middleware), but it's a latent Edge risk + bloats the 135 kB middleware. **Fix:** Auth.js
   v5 split-config — an edge-safe `auth.config.ts` (providers + callbacks, no adapter) imported by
   `middleware.ts`; keep the full `auth.ts` (with adapter) for route handlers. *(The warning is hidden in
   incremental builds — only a clean build surfaces it.)*
2. **[Low] `npm run lint` is broken.** `next lint` is deprecated in Next 15.5 and there's no ESLint
   config, so it drops into an interactive prompt (hangs CI). Build-time type validation still runs.
   **Fix:** migrate to the ESLint CLI (`eslint.config.mjs`) or drop the script.
3. **[Low] Two self-described "TEMPORARY" routes ship in the build:** `app/api/health/db/route.ts`
   (hardcoded `DIAG_TOKEN` in source; token-gated, leaks only host:port + raw PG error) and
   `app/api/dev/scan/route.ts` (env-flag gated). Both say "remove before launch" in their own comments.
4. **[Low] The scanner false-positives on its own stack.** `preflight.mjs` `AUTH_HINTS` (~line 103)
   doesn't recognize the Auth.js v5 `auth()` idiom, so the self-scan flags 6 properly-authed routes as
   "no detectable auth check" (MEDIUM heuristic — does NOT gate). Add `auth()` / `await auth()` to the
   hint list to cut false positives for the Next.js + Auth.js v5 audience. Mirror the change in
   `lib/scanner/rules.ts` and update `test/` fixtures (the parity harness will fail otherwise).
5. **[Info] `UntrustedHost` on `/api/auth/session`** in a zero-env localhost run — auto-handled by Vercel
   in prod (auto-trust). Non-fatal. Just confirm prod has `AUTH_URL`/`AUTH_TRUST_HOST` as expected.

---

## 3. Non-negotiable constraints (every change honors these — this is LAW)

1. **Fail-soft at import.** No module may throw at load time. `npm run build` + `tsc --noEmit` MUST pass
   with **zero env vars**. Clients (Stripe, DB, Anthropic, GitHub App) lazy-init and degrade.
2. **Never put a secret in `NEXT_PUBLIC_`.** Server-only env for all credentials.
3. **AI is invisible.** No customer-facing string (dashboard, marketing, check-run output, Action console
   logs) may mention AI, Claude, Anthropic, LLM, or "model." The deterministic scanner is the product.
4. **Never claim "secure" or "compliant."** Say "posture against specific controls" / "deploy-time gate,
   not a certification." Negated guardrails ("we can't guarantee security") are fine.
5. **Raw `PREFLIGHT_API_KEY` is hash-only at rest** (`lib/apiKey.ts`). Never log, return, or cache it.
6. **`main` may be shared.** Fast-forward pushes only. **Never force-push. Never `--no-verify`/skip hooks.**
7. **Don't commit secrets** or working docs (this file, `FULL_SCOPE_BRIEF.md`) unless asked.

---

## 4. How to verify your work (run before declaring anything done)

```bash
npm run typecheck            # must be clean
npm test                     # scanner parity must PASS
node preflight.mjs .         # self-scan: must be 0 HIGH (Preflight passes its own gate)
npm run build                # must succeed

# Zero-env build check (the §3.1 constraint). .env.local is gitignored; this relocates it safely:
mv .env.local /tmp/pf_env.bak && rm -rf .next && npm run build ; mv /tmp/pf_env.bak .env.local
```

A vulnerable sample (3 HIGH → exit 1) confirms the gate blocks; a clean tree → exit 0 confirms it passes.

---

## 5. Work remaining (prioritized)

**First:** the five issues in §2 (start with #1, the auth split-config).

**Then — the four workstreams (full detail in `FULL_SCOPE_BRIEF.md`):**
- **A — Automatic Vercel gate verification.** Replace self-attested `gateState` with a real Vercel API
  read of required checks. (`lib/gates/vercel*.ts` — connection plumbing exists; `verifyRequired` real impl.)
- **B — Multi-provider gates (Netlify, Cloudflare).** Adapters exist (`lib/gates/netlify.ts`,
  `cloudflare.ts`); finish `GateContext` widening, `provision`/`teardown`, and provider-parameterized
  `WORKFLOW_YAML`.
- **C — Onboarding/marketing polish.** Copy violations are fixed; remaining: dashboard restyle, honest
  "connected vs. gating" state (depends on A), empty/error states, docs/support surface.
- **D — Hardened billing/accounts.** Webhook race + idempotency ledger, full Stripe lifecycle (dunning),
  account deletion / Stripe + GitHub-App teardown, reconciliation job.

**Operator-only actions (cannot be done by an agent — `FULL_SCOPE_BRIEF.md` §11):** apply DB migrations to
prod Supabase, register the GitHub App + set `GITHUB_APP_*` env in Vercel, obtain a Vercel API token for
Workstream A, confirm Stripe portal/price/webhook secrets, decide the long-term domain.

---

## 6. Gotchas / landmines

- **`.env.local` exists** (preview basic-auth creds + likely a real `DATABASE_URL`). Next loads it for
  `dev`/`build`/`start`. To test *true* zero-env, move it aside (see §4). It is gitignored — safe to relocate.
- **The Edge warning only shows on a CLEAN build** (`rm -rf .next` first). Incremental builds hide it.
- **Self-scan MEDIUMs are false positives** (issue #4) — `auth()` isn't recognized. Don't "fix" auth on
  routes that already call `auth()`/verify HMAC/Stripe sigs.
- **Two scanner engines must stay in sync:** `preflight.mjs` (the live CLI/Action) and `lib/scanner/*`
  (the in-process backend worker). `test/run.mjs` enforces byte-for-byte parity — change both together.
- **`main` is shared with another agent.** Pull/rebase, fast-forward only, never force-push.

---

## 7. Codebase map (where things live)

| Path | What |
|---|---|
| `preflight.mjs` | The product: zero-dep CLI scanner, 8 checks (A–H), exits 1 on HIGH |
| `lib/scanner/*` | Same logic extracted for the in-process backend worker (parity-tested) |
| `action/report.mjs` | Posts the `preflight` GitHub check run from local findings |
| `app/api/enrich/` | Backend enrichment endpoint (Bearer-auth, subscription-aware, fail-soft) |
| `app/api/github/` | GitHub App setup + webhooks |
| `app/api/stripe/` | Checkout, portal, webhook |
| `app/api/cron/drain`, `worker/`, `lib/queue.ts`, `lib/worker.ts` | Async scan queue + drainers |
| `auth.ts`, `middleware.ts` | Auth.js v5 + route protection (see issue #1) |
| `db/schema.ts`, `db/migrations/` | Drizzle schema + migrations (0000–0007) |
| `lib/gates/*` | Pluggable deploy-gate providers (Vercel live; Netlify/Cloudflare in progress) |
| `test/run.mjs` | Scanner parity harness (`npm test`) |
| `FULL_SCOPE_BRIEF.md` | The deep brief — read after this file |
