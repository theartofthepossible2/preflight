# Preflight — Full-Scope Execution Brief

> **Status:** Working document, untracked, safe to delete or move. Authored 2026-06-02 from a four-stream
> read-only audit of the repo at `preflight-seven.vercel.app`. Every claim below carries a file:line and a
> confidence tag: **[verified]** = read firsthand this session; **[audit]** = reported by an audit agent,
> spot-check before acting.
>
> **Purpose:** A single source of truth a fresh set of agents (or the same one) can execute against to
> ship the full-scope product. It maps current state, lists go-live blockers, and breaks the four chosen
> scope areas into self-contained workstreams with concrete tasks, file paths, and acceptance criteria.

---

## 0. How to use this brief

- **Read §1 first and treat it as law.** Those constraints apply to every change in every workstream.
- Workstreams **A–D** map 1:1 to the four scope areas you chose. **§9** is cross-cutting work that
  doesn't belong to one area. **§4** is the go-live punch list that must land before launch regardless
  of which workstream you prioritize.
- Each workstream is self-contained: an agent can own one without reading the others. Where a dependency
  exists, it is called out explicitly. See **§10** for the sequencing graph.
- Tasks are written as outcomes with acceptance criteria, not keystrokes — make judgment calls within the
  constraints.

---

## 1. Non-negotiable constraints (every agent honors these)

1. **Fail-soft at import.** No module may throw at load time. `npm run build` and `tsc --noEmit` MUST pass
   with **zero environment variables set**. Clients (Stripe, DB, Anthropic, GitHub App) lazy-init and
   degrade; they never throw when a key is missing. Precedent: `db/index.ts`, `lib/stripe.ts`,
   `lib/github/app.ts` all use placeholder fallbacks. **[verified]**
2. **Never put a secret in `NEXT_PUBLIC_`.** Server-only env for all credentials.
3. **AI is invisible.** No customer-facing string may mention AI, Claude, Anthropic, LLM, or "model." The
   deterministic scanner is the product; enrichment is an unnamed implementation detail. This includes
   dashboard copy, marketing, check-run output, AND log lines the customer can see in their Action console.
4. **Never claim "secure" or "compliant."** Say "posture against specific controls" / "deploy-time gate,
   not a certification." Negated guardrails ("we can't guarantee security") are fine.
5. **The raw `PREFLIGHT_API_KEY` flows customer-CI → our backend only.** Only its SHA-256 hash persists
   (`lib/apiKey.ts`). Never log, return, or cache the raw token. The GitHub-App write path sends it
   straight into a libsodium sealed box (`lib/github/secrets.ts`).
6. **`main` may be shared with another agent.** Fast-forward pushes only. **Never force-push.** Never
   `--no-verify` / skip hooks.
7. **Don't commit secrets**, and don't commit this brief or other working docs unless asked.

---

## 2. Architecture on one screen

**The gate pipeline (the product):**
```
Customer connects repo (GitHub App)  ─►  workflow file + PREFLIGHT_API_KEY secret written to repo
        │
Vercel finishes a production build   ─►  repository_dispatch: vercel.deployment.success
        │
GitHub Action runs in CUSTOMER's CI  ─►  preflight.mjs scans checked-out code (local decision)
        │                                 └─► best-effort POST /api/enrich (Bearer pflt_…) for explanations
        │
Action posts a GitHub check run named `preflight` (pass/fail from LOCAL findings)
        │
Vercel Deployment Checks auto-discovers `preflight` by name  ─►  gates Production promotion
```

**Two distinct GitHub identities — do not conflate:**
- **Sign-in OAuth app** (`auth.ts`): identity only. No repo scope.
- **GitHub App** (`lib/github/app.ts`): scoped, revocable repo automation (Contents/Workflows/Secrets
  write). Powers one-click connect. Separate registration, separate env (`GITHUB_APP_*`).

**Key invariant:** the gate decision is made **locally** in the Action (`action/report.mjs:53`), never by
our backend. A backend outage or lapsed subscription can never let a HIGH finding pass — enrichment just
degrades. This is correct and must be preserved.

**Stack:** Next.js 15 App Router · TypeScript · Drizzle ORM · Supabase Postgres (pooler) · Auth.js v5-beta
· Stripe (flat $29/mo) · Anthropic SDK (enrichment, invisible). Host: `preflight-seven.vercel.app`.

---

## 3. Current state — what's solid vs. what's not

| Area | Solid | Not solid |
|---|---|---|
| **Scanner core** | Local-decision gate design; AI-invisible; zero-dep `preflight.mjs` | Only 4 checks/~6 rules; regex-only (no AST); **two engines** (`preflight.mjs` live, `lib/scanner/*` dead & drifting) |
| **Enrich backend** | Bearer auth, subscription-aware degrade, type-guarded input | **Cost cache unbuilt** (`lib/cache.ts` missing); per-instance rate limit; raw model error can reach customer log |
| **Gating** | Consistent `preflight` contract across install page/dashboard/action; clean install copy | Gate **never verified** (`verifyRequired` returns `'unverified'`); workflow YAML embeds a confusingly-named second status; `settingsUrl` is a bare dashboard link |
| **GitHub App connect** | OAuth-verified binding; idempotent workflow write w/ drift; safe key rotation; HMAC webhook | App **not yet registered** in prod; **migration 0002 unapplied** → Configure 500s |
| **Billing/auth** | Webhook sig verified; lazy Stripe client; key hashing | Webhook misses `invoice.*`; race on `checkout.session.completed`; no idempotency ledger; **no account deletion / Stripe teardown** |
| **Marketing/onboarding** | Polished Tailwind marketing; honest "posture" framing; correct `preflight` instructions | **AI leaks in dashboard**; **false "no repo access"** claims; dashboard is unstyled legacy CSS vs. marketing |
| **Infra** | Strong prod headers (HSTS, frame-ancestors none); middleware excludes `/api` correctly | CSP `script-src 'unsafe-inline'`; no migrate step in deploy |

---

## 4. GO-LIVE BLOCKERS (fix before launch — roughly in order)

These are launch-gating regardless of which big workstream you start. Most are small and unambiguous.

### P0-1 — Apply migration 0002 in production. **[audit: B, D]**
`db/migrations/0002_flat_husk.sql` creates `github_installation` + `repo_setup`. `db:migrate` =
`drizzle-kit migrate` (`package.json:14`) with **no deploy step running it**. Until applied, every
Configure/setup write throws — and `configureRepoAction`'s final `db.insert` (`app/dashboard/github-actions.ts:123`)
is **outside** the try/catch, so it 500s the server action. **Action:** run the migration against prod
Supabase, and add a migrate step to the deploy pipeline so this can't recur. *(Ops action — needs the
operator; see §11.)*

### P0-2 — Fix customer-facing copy violations. **[verified]**
These break the AI-invisible and accuracy contracts:
- `app/dashboard/page.tsx:91` — "AI-enriched findings are active on every scan." → reword w/o "AI".
- `app/dashboard/page.tsx:92` — "...findings come back without AI analysis..." → reword.
- `app/dashboard/page.tsx:129` — `{s.aiEnriched ? 'AI-enriched' : 'deterministic only'}` → e.g.
  `'enriched'` / `'findings only'` (a non-AI word; the column stays `aiEnriched` internally).
- `app/(marketing)/privacy/page.tsx:90` — "...automated analysis (including AI) providers." → drop "(including AI)" or say "third-party analysis provider". **[audit: C]**
- `app/signin/page.tsx:88` — "Preflight does not request repo access" is **now false** (the GitHub App
  requests Contents/Workflows/Secrets write). Reword to distinguish sign-in (identity only) from the
  optional, per-repo GitHub App you authorize for one-click setup; the scan still runs in your CI on the
  built-in `GITHUB_TOKEN`. **[verified]**
- `app/(marketing)/page.tsx:117` — reported "No tokens, no access to your repo..." Same falsehood; verify
  exact string then reword. **[audit: C — spot-check the line]**

### P0-3 — Resolve the workflow check-name confusion. **[verified]**
`lib/github/workflow-template.ts` sets the workflow `name: Preflight Security Gate` (line 22) and the
`vercel/repository-dispatch/actions/status@v1` step `name: Preflight Security Gate` (line 37). That posts a
**commit status** literally called "Preflight Security Gate" — a *different* name from the `preflight`
**check run** the action posts (`action/report.mjs:133`) and the one all customer copy correctly tells
users to require. The gate works (Vercel gates on `preflight`), but the stray status confuses customers and
risks them requiring the wrong name. **Action:** rename the status-step `name` (and optionally the workflow
`name`) to something that reads as the same thing as `preflight`, or document why the status exists. Keep
`CHECK_NAME='preflight'` as the canonical gated check. Because the YAML is the single source of truth, one
edit propagates to install page, dashboard, and the writer.

### P0-4 — Build the Anthropic cost cache (COGS protection). **[audit: A]**
`db/schema.ts:132` defines `analysisCache` and references "see lib/cache.ts" — **the file does not exist**
and the table is used nowhere. `/api/enrich` calls Anthropic on **every** request for an active sub, so an
unchanged repo is re-billed every push. **Action:** implement content-hash dedupe (hash the normalized
finding set; return cached enrichment on hit). This is one of the four stated COGS levers and a real
launch-cost risk.

### P0-5 — Durable, per-user rate limiting. **[audit: A, B]**
`lib/rateLimit.ts` is a module-level in-memory `Map` — on Vercel serverless each cold start/instance has
its own bucket, so the limit is effectively unenforced. **Action:** move to a shared store (Postgres
table or Upstash/Redis), keyed per-user, with a request-size cap on `findings[]`.

### P0-6 — Register the GitHub App + capture prod env. **[verified: not registered locally]**
One-click connect is dead until the App exists and its env is set in Vercel. Permissions: Contents R/W,
Workflows R/W, Secrets R/W, Metadata R. Setup URL + Callback URL = `https://preflight-seven.vercel.app/api/github/setup`.
Webhook URL = `https://preflight-seven.vercel.app/api/github/webhooks`. "Request user authorization (OAuth)
during installation" = ON. Env: `GITHUB_APP_ID`, `_SLUG`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_PRIVATE_KEY`
(PEM, one line, `\n` escapes), `_WEBHOOK_SECRET`. *(Ops action — needs the operator; see §11.)*

---

## 5. Workstream A — Fully automatic Vercel gating (Phase 2)

**Goal:** replace the manual "Mark as required" attestation with real verification that the customer's
Vercel project actually requires the `preflight` check for Production.

**Today:** `lib/gates/vercel.ts` `verifyRequired()` returns `'unverified'` unconditionally; `attestGateAction`
(`app/dashboard/github-actions.ts:226`) just sets `gateState='required'` on the user's say-so;
`settingsUrl()` returns the bare `https://vercel.com/dashboard`. No Vercel API call exists anywhere. **[verified]**

**Tasks:**
1. **Capture a Vercel credential + project identity.** Add a Vercel Integration (OAuth) connect flow, or
   accept a scoped Vercel access token, plus the customer's `teamId`/`projectId`. **Schema change
   required** — there is no column for any of this today (`types.ts` comment claiming "no schema change"
   is wrong for Phase 2). Add a `vercel_connection` table or columns on `repoSetups`; write a new
   migration. Store tokens encrypted; never `NEXT_PUBLIC_`.
2. **Implement real `verifyRequired`.** Call the Vercel REST API to read the project's Deployment Checks /
   required-checks config and confirm `preflight` is required for Production. Return `'required'` /
   `'missing'` / `'error'` accordingly. Persist `gateState` + `gateLastCheckedAt` (columns already exist,
   `db/schema.ts:192-195`).
3. **Project-specific `settingsUrl`.** Once `teamId`/`projectId` are known, deep-link to the project's
   Deployment Checks page instead of the bare dashboard.
4. **Re-verify on a cadence** (e.g. a cron or on dashboard load) so a customer toggling the check off later
   is reflected. Keep it fail-soft.
5. **Widen `GateContext`** to carry the provider token ref + project identity (see Workstream B — do this
   once, shared).

**Acceptance:** a connected repo shows `gate required` only after a real API read confirms it; turning the
check off in Vercel flips the dashboard to `gate missing` within the re-verify window; build passes zero-env.

---

## 6. Workstream B — Multi-provider deploy gates (Phase 3: Netlify, Cloudflare Pages)

**Goal:** support deploy gates beyond Vercel behind the existing `lib/gates/` abstraction.

**Today:** the abstraction is real but anemic. `GateContext` carries only `{ repoFullName }`
(`lib/gates/types.ts:7`); the registry has one entry with Vercel fallback (`lib/gates/index.ts`);
`DEFAULT_GATE_PROVIDER='vercel'`. `repoSetups.gateProvider`/`gateState` already generalize. **[verified]**

**Seams that must change before a second provider fits:**
1. **`GateContext` is too thin.** It must carry provider-specific identity (token ref, account/site/project
   id), not just `repoFullName`. The dashboard currently calls every method with `repoFullName: ''`
   (`app/dashboard/page.tsx:48-49`), so instructions/URLs are static — fix that too.
2. **No provisioning method.** Vercel auto-discovers a GitHub check run by name; Netlify/Cloudflare **do
   not** — they need a deploy hook / build plugin / API-driven status. The `DeployGateProvider` interface
   has no hook for "configure the provider side." Add one (e.g. `provision(ctx)` / `teardown(ctx)`).
3. **The dispatch trigger is hardcoded.** `WORKFLOW_YAML` pins `repository_dispatch: vercel.deployment.success`
   (`lib/github/workflow-template.ts:24`). Other providers fire different events (or none). The workflow
   template must become provider-parameterized (multi-trigger or per-provider YAML). The registry
   abstraction does not reach the YAML today — that's the biggest refactor.

**Tasks:** widen `GateContext` (shared with A); add `provision`/`teardown` to the interface + Vercel no-op
impl; parameterize `WORKFLOW_YAML` by provider; add Netlify and Cloudflare adapters (instructions,
settingsUrl, verifyRequired, provision); add registry entries; surface provider choice in the connect UI.

**Acceptance:** a customer can pick Netlify or Cloudflare at connect time; the correct workflow trigger is
written; `verifyRequired` works per-provider; Vercel behavior is unchanged; build passes zero-env.

---

## 7. Workstream C — Polished onboarding + marketing

**Goal:** an honest, compelling funnel where "connected" provably becomes "gating," and the post-signup
experience matches the marketing polish.

**Tasks:**
1. **Land all of P0-2** (copy violations) and **P0-3** (workflow name) — they live here.
2. **Close the "connected vs. gating" gap.** Depends on Workstream A's `verifyRequired`: show a true gate
   state, not a self-attested one. Until A lands, make the attestation language honest ("you've told us
   it's required" not "required").
3. **Restyle the dashboard.** It's unstyled legacy CSS (`app/dashboard/page.tsx` inline styles,
   `class="uploader"`) vs. the polished Tailwind marketing — jarring post-signup. **[audit: C]**
4. **Fix empty/error states.** "Recent scans" empty state (`app/dashboard/page.tsx:111`) says "Add the
   Preflight Action to a workflow file and push" even for one-click users. Add guidance for "workflow set
   but no scan arrived yet" (e.g. Vercel dispatch not firing). **[verified]**
5. **De-duplicate onboarding paths.** The dashboard always renders the "Manual setup" YAML block
   (`app/dashboard/page.tsx:138-149`) even after automated connect — collapse/hide it once connected. **[verified]**
6. **Add a docs/support surface.** Footer has only Product + Get-started; no docs, status, or support link.
   Surface support outside the legal pages. **[audit: C]**
7. **Pricing clarity.** Note that Vercel Deployment Checks itself requires a paid Vercel plan — currently
   unmentioned anywhere. **[audit: C]**
8. **Confirm the license reference resolves.** `terms`/`privacy` reference "the Preflight Software License"
   — ensure that file ships (it does: recent commit added a proprietary license) and the link isn't
   dangling. **[audit: C — verify]**

**Acceptance:** no AI/secure/compliant/false-access strings anywhere customer-facing (grep clean); dashboard
visually consistent with marketing; empty/error states guide the user; manual block hidden when connected.

---

## 8. Workstream D — Hardened billing + accounts

**Goal:** trustworthy subscription state, real dunning, and lawful account lifecycle.

**Today:** webhook verifies signatures and handles `checkout.session.completed` +
`customer.subscription.created/updated/deleted`; `getSubscriptionState` is purely DB-derived;
`.active` = status in `{active, trialing}`. **[audit: B]**

**Tasks:**
1. **Fix the webhook race.** `checkout.session.completed` hard-writes `status:'active'`
   (`app/api/stripe/webhook/route.ts` ~36-41); if a `customer.subscription.updated` (e.g. immediate
   `past_due`/cancel) is processed first, `completed` overwrites it back to active. Read the real
   subscription status instead of hardcoding `'active'`, or guard by event timestamp.
2. **Handle the full lifecycle.** Add `invoice.payment_failed`, `invoice.paid`,
   `customer.subscription.trial_will_end`. Wire dunning UX (notice in dashboard; optional email).
3. **Idempotency ledger.** Persist processed Stripe `event.id`s; skip replays. Protects against reordering.
4. **Reconciliation job.** A scheduled Stripe→DB sync so a missed webhook doesn't silently drift state
   permanently (today `getSubscriptionState` is the only source of truth and never self-heals).
5. **Account deletion / GDPR.** **None exists.** Deleting a user cascades app rows but leaves the Stripe
   customer + subscription **live → continued billing of a deleted account.** Add a delete-account flow
   that cancels the Stripe subscription, deletes/anonymizes the customer, revokes API keys, and removes
   GitHub App installations. Add data export if pursuing GDPR.
6. **Fix the orphan-customer race** in `getOrCreateStripeCustomer` (`lib/stripe.ts:37-55`): concurrent
   checkout+portal can create two Stripe customers; `onConflictDoNothing` prevents a dup row but leaks an
   orphan Stripe customer. Make it transactional or reconcile.
7. **Entitlement model (optional, scope-dependent).** Today `.active` is binary per-user and unlocks
   unlimited repos/keys/scans. If you want per-repo/seat/usage limits, add metering (the `scan` table
   already records usage).

**Acceptance:** webhook is replay-safe and reflects true Stripe state under reordering; a failed renewal
surfaces to the user; deleting an account stops billing and tears down Stripe + GitHub App + keys; build
passes zero-env; webhook signature verification preserved.

---

## 9. Cross-cutting (not owned by one workstream)

- **Scanner depth.** Only 4 checks. Add high-signal rules: committed `.env`/secret files, wildcard CORS,
  `dangerouslySetInnerHTML`/XSS sinks, missing CSRF on mutations, open redirects, `eval`,
  `NODE_TLS_REJECT_UNAUTHORIZED=0`, vulnerable-dependency surface. ASVS coverage is a hand-curated
  7-requirement subset (`lib/asvs/asvs-5.0.json`, IDs noted as unverified) — this is the trigger for the
  planned Skills/Console-Agents migration (retrieval over the full ASVS). **[audit: A]**
- **Kill the dead scanner.** Decide between `preflight.mjs` (live) and `lib/scanner/*` (dead, zero callers,
  already drifted — its connection-string check lost the localhost/placeholder guard). Delete one; two
  engines guarantee divergence. **[audit: A]**
- **Check-run SHA under `repository_dispatch`.** `action/report.mjs:59` uses `GITHUB_SHA` (default-branch
  tip). If prod ever deploys a non-HEAD commit, the `preflight` check posts to the wrong SHA and Vercel
  won't see it. Use the dispatch payload's ref/sha. **[audit: D — verify against Vercel's dispatch payload]**
- **Sanitize the customer-visible log line.** `action/report.mjs:155` logs `enriched.aiError` verbatim;
  a raw SDK error string could contain a model/provider name → AI-invisibility leak in the Action console.
  The check-run summary is already safe. **[audit: A]**
- **CSP.** `next.config.ts:8` uses `script-src 'unsafe-inline'`. Move to a nonce/hash strategy if feasible
  to harden XSS defense. **[audit: D]**
- **Stale `action.yml` description.** Says "Scans on push"; real trigger is `repository_dispatch`. **[audit: A]**

---

## 10. Sequencing & dependency graph

```
P0 BLOCKERS (do first, mostly small/independent):
  P0-1 migrate prod ───────────────┐ (ops)
  P0-6 register App + env ──────────┤ (ops)         ← both unblock real connect testing
  P0-2 copy fixes ─┐
  P0-3 workflow name ┤ (Workstream C owns 2+3)
  P0-4 cost cache ─┐
  P0-5 rate limit ─┘ (independent, do anytime)

THEN, in parallel:
  Workstream A (Phase 2 Vercel verify) ──► needs schema migration + Vercel creds
        │  └── widen GateContext (shared seam) ──┐
  Workstream B (Phase 3 providers) ◄────────────┘ needs the SAME GateContext widening + provisioning hook
        │                                          + WORKFLOW_YAML parameterization
  Workstream C (onboarding/marketing) ──► P0-2/P0-3 here; "gating vs connected" item depends on A
  Workstream D (billing/accounts) ──► fully independent; can start immediately
```

**Critical shared seam:** widening `GateContext` + the `provision` hook is needed by **both A and B** — do
it once, first, before splitting A and B to separate agents. **Workstream D is independent** and a good
candidate to run fully in parallel from day one.

---

## 11. Operator (human) actions — cannot be done by an agent

1. **Apply migration 0002 to prod Supabase** (P0-1) and confirm `github_installation` + `repo_setup` exist.
2. **Register the GitHub App** and set the six `GITHUB_APP_*` env vars in Vercel (P0-6, config in that item).
3. **Phase 2 (Workstream A):** create the Vercel Integration / obtain the Vercel API token scope, and decide
   token model (per-customer OAuth vs. team token).
4. **Stripe dashboard:** confirm the Billing Portal is configured (account management delegates to it), and
   that `STRIPE_PRICE_ID` / webhook secret are set in prod.
5. Decide TLD / long-term domain (currently `preflight-seven.vercel.app`).

---

## 12. Definition of done (whole product, launch bar)

- `npm run build` + `tsc --noEmit` green with **zero env**; CI runs migrations on deploy.
- Grep across `app/` is clean of AI/Claude/Anthropic/LLM/model and "secure"/"compliant" in customer copy;
  no false "no repo access" claim remains.
- One-click connect works end-to-end against a real repo: workflow + secret written, dispatch fires, action
  posts `preflight`, Vercel gates Production, dashboard shows a **verified** gate state.
- Anthropic spend is bounded by the content-hash cache; rate limiting is durable and per-user.
- Billing reflects true Stripe state under webhook reordering; failed renewals surface; account deletion
  stops billing and tears down Stripe + GitHub App + keys.
- (If in scope) Netlify/Cloudflare selectable at connect time with correct triggers and verification.
