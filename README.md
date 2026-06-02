# Preflight v0.3

A security gate for Next.js + Supabase/Neon projects. Runs as a GitHub Action on every push,
posts a Check Run, and blocks Vercel deploys on HIGH findings via Vercel's native Deployment
Checks. AI explanations grounded in OWASP ASVS 5.0 are served from a product-owned key on the
Preflight backend; customers never paste an AI key.

## Architecture (v0.3)

```
 ┌─────────────────────┐         ┌────────────────────────┐         ┌────────────┐
 │  customer's repo    │ push →  │ Preflight GitHub Action│ ── if   │ Preflight  │
 │  .github/workflows/ │         │ - runs scanner locally │ findings│ backend    │
 │  preflight.yml      │         │ - POST /api/enrich     │ ───────►│ - auth     │
 └─────────────────────┘         └────────────────────────┘         │ - cache    │
                                                                    │ - Anthropic│
                                                                    └────────────┘
            ↑                          │
            └── posts Check Run ───────┘
                          │
                          ▼
                    GitHub Check
                          │
                          ▼
                  Vercel Deployment Check (native, marks check as required)
                          │
                          ▼
            production promotion gated until pass
```

**Deterministic scanner is the backbone** — it runs in the customer's CI on the checked-out code,
needs no tokens, and emits findings the same way `preflight.mjs` does. **AI is an invisible
enrichment layer** — only invoked when findings exist, and only on the backend with the
product-owned key.

## Local setup

```bash
# 1. install deps
npm install

# 2. configure env
cp .env.example .env.local
# fill in DATABASE_URL, AUTH_*, STRIPE_*, ANTHROPIC_API_KEY

# 3. run migrations against your Neon DB
npm run db:generate
npm run db:migrate

# 4. start dev server
npm run dev
```

## External setup (one-time)

- **Supabase Postgres** — in your project: Connect → use a **pooler** connection string
  (`...pooler.supabase.com`), either Transaction (6543, ideal for serverless) or Session (5432).
  Do **not** use the Direct connection (`db.[ref].supabase.co`) — it's IPv6-only and fails on
  Vercel serverless. Copy to `DATABASE_URL`. The client sets `prepare: false`, so either pooler
  port works. Preflight uses Supabase as a managed Postgres only; we don't use Supabase
  Auth / Storage / Realtime (Auth.js handles auth).
- **GitHub OAuth app** (github.com/settings/developers) → set callback URL to
  `http://localhost:3000/api/auth/callback/github` (and your prod URL) → `AUTH_GITHUB_ID` and
  `AUTH_GITHUB_SECRET`. Generate `AUTH_SECRET` via `openssl rand -base64 32`.
- **Stripe** product + recurring $29 price → `STRIPE_PRICE_ID`. Forward webhooks to
  `/api/stripe/webhook` (`stripe listen --forward-to localhost:3000/api/stripe/webhook` in dev)
  → `STRIPE_WEBHOOK_SECRET`.
- **Anthropic** API key → `ANTHROPIC_API_KEY` (server env only).

## Layout

```
app/
  page.tsx                     marketing / landing
  signin/page.tsx              Auth.js GitHub sign-in
  dashboard/                   signed-in dashboard (subscription, API keys, scan history)
  api/auth/[...nextauth]/      Auth.js handlers
  api/stripe/checkout/         Stripe Checkout session
  api/stripe/portal/           Stripe Customer Portal session
  api/stripe/webhook/          Stripe webhook → subscription state
  api/enrich/                  Bearer-auth endpoint the Action calls with findings
auth.ts                        Auth.js config (Drizzle adapter, GitHub provider, JWT sessions)
middleware.ts                  Protects /dashboard
db/
  schema.ts                    Drizzle schema (Auth.js + subscriptions + apiKeys + scans + cache)
  index.ts                     Neon-backed Drizzle client
lib/
  scanner/                     Deterministic scanner (from v0.2, unchanged)
  analyze/                     Anthropic enrichment (from v0.2, unchanged)
  asvs/                        Curated ASVS 5.0 subset
  stripe.ts                    Stripe helpers + subscription state lookup
  apiKey.ts                    Issue / list / revoke / authenticate API keys
  rateLimit.ts                 Per-key rate limiting on /api/enrich
preflight.mjs                  Reference CLI implementation
```

## Coming next

- The GitHub Action itself (`preflight-action`) — separate repo, published to Marketplace.
- Content-hash analysis cache wired into `/api/enrich` (table is in place).
- Model tiering (Haiku first-pass, Sonnet for HIGH / ambiguous).
