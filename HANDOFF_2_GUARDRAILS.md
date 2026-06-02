# Handoff 2 — backend guardrails (don't break the working app)

> For the agent doing the UX/marketing pass in the side-worktree. The backend (auth, DB, billing,
> API, middleware) is **working in production** as of 2026-06-01 — sign-in → `/dashboard` works end to
> end. Your work is **additive restyling + new marketing surface**, not a backend rebuild. This file
> is the "if you touch these, you will break prod" list, grounded in the actual code on `main`.

## TL;DR — the five things most likely to break prod

1. **Don't change the `middleware.ts` matcher.** It deliberately excludes `/api`. Break that and OAuth
   (and every API route) goes behind basic-auth → 500s on sign-in.
2. **Don't "fix" `db/index.ts` or `lib/stripe.ts`.** They're intentionally fail-soft so the Vercel
   build doesn't abort with no env vars. They look wrong on purpose.
3. **If you add ANY external asset (fonts, images, analytics, embeds), update the prod CSP in
   `next.config.ts`** or it works in dev and silently breaks in production.
4. **Never put a secret in a `NEXT_PUBLIC_` var.** Anything AI/DB/Stripe/auth stays server-side.
5. **`npm run build` and `npm run typecheck` must both pass with zero env vars set** before you hand
   back. That's the same gate Vercel uses.

## Do-not-touch (backend — restyling has no reason to edit these)

These are load-bearing and currently correct. Leave their logic alone:

- `auth.ts` — Auth.js v5 config (GitHub provider, Drizzle adapter, JWT sessions). The OAuth callback
  writes user/account rows through the adapter; a change here that throws renders as a generic
  "Server configuration" 500. This took a full debugging session to get green — don't perturb it.
- `middleware.ts` — basic-auth preview gate **and** the `/dashboard` session guard. See matcher note
  below.
- `db/index.ts`, `db/schema.ts`, `db/migrations/**` — DB client + schema. The client is fail-soft (see
  below). Don't touch the schema or migrations from the frontend.
- `lib/**` — `apiKey`, `stripe`, `scanner/**`, `analyze/**`, `asvs/**`, `rateLimit`, `types`. Pure
  backend.
- `app/api/**` — every route handler (`auth/[...nextauth]`, `enrich`, `stripe/{checkout,portal,webhook}`,
  and the temporary `health/db` — see cleanup note). No styling lives here.
- `drizzle.config.ts`, `next.config.ts` (except the documented CSP additions below).

## Safe to touch (this is your surface)

- `app/page.tsx` — the landing page. Rebuild this freely.
- `app/signin/page.tsx` — restyle freely, **but** keep whatever call kicks off the GitHub sign-in
  intact (the button must still trigger the same `signIn`/route and preserve any `callbackUrl`). Style
  the button, don't rewire the flow.
- `app/dashboard/page.tsx`, `app/dashboard/dashboard-client.tsx`, `app/dashboard/actions.ts` —
  **this works; don't regress it.** Restyling the markup is fine; do not change the data flow, the
  server action signatures, or what the client component fetches/posts.
- `app/globals.css` — the whole theme lives here today. Yours to evolve.
- `app/layout.tsx` — safe to edit the **content/metadata** and to add fonts (see CSP note). Keep
  `import './globals.css'` and the `<html>/<body>` shell. Two copy fixes to make while you're here:
  - `title` and `description` currently read *"ASVS posture check"* / *"AI-augmented ASVS 5.0
    explanations."* The description **violates the positioning rules** (no "AI" in customer-facing
    copy; never imply "ASVS compliant"). This metadata is customer-facing (it's the `<title>` and OG
    description) — rewrite it to the approved positioning.
- New files: new route segments (e.g. `app/pricing/`, `app/docs/`), new components, new CSS. All fine.

## The middleware matcher (read this before touching `middleware.ts`)

```ts
export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] };
```

- It runs the `auth()` wrapper on **every route except `/api`, Next static assets, and favicon**.
- Consequence 1: **all your marketing pages sit behind the basic-auth preview gate** when
  `PREVIEW_USERNAME`/`PREVIEW_PASSWORD` are set. That's expected and fine for preview. Don't try to
  exempt marketing pages from it.
- Consequence 2: `/api/**` is **excluded on purpose** — that's why the GitHub OAuth callback
  (`/api/auth/callback/github`) and every API route are reachable without basic-auth. If you add
  `api` back into the matched set, or remove the negative-lookahead, **sign-in 500s**. Do not edit the
  matcher to "protect more pages."
- Only `/dashboard*` requires a logged-in session (`PROTECTED_PREFIXES`). If you add a new gated area,
  add its prefix there — but you almost certainly don't need to for marketing pages (they should be
  public).

## The fail-soft modules (they look broken; they are not)

`db/index.ts` falls back to a placeholder Postgres URL and `lib/stripe.ts` falls back to
`sk_test_placeholder` when env vars are missing. This is **deliberate**: Vercel imports these at build
time before runtime env vars exist, and a throw at module load would abort the build. Do not "clean
them up," add `throw new Error('missing env')`, or make them strict. If a real call fails at runtime,
that's the intended signal that an env var is unset.

## CSP — the silent prod-only trap

`next.config.ts` ships a **strict Content-Security-Policy in production only** (dev uses a relaxed
set). So external assets will work on your machine and then break on `preflight-seven.vercel.app`.
Current prod policy:

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none';
base-uri 'self'; frame-ancestors 'none'
```

- **Strongly preferred: avoid CSP edits entirely.** Use `next/font` (self-hosts fonts → stays under
  `'self'`), self-host any images/SVGs in `/public`, and skip third-party embeds. Inline `<style>`
  and styled-jsx already work (`'unsafe-inline'` is allowed for style/script).
- If you *must* add an external origin, add it to the matching directive in `PROD_SECURITY_HEADERS`:
  - Google Fonts → `style-src ... https://fonts.googleapis.com` **and**
    `font-src ... https://fonts.gstatic.com`
  - external images / a CDN → `img-src ... https://that-host`
  - analytics/beacons → `connect-src ... https://that-host` (and `script-src` if it injects a script)
- Test the production header set locally with `npm run build && npm start` (NODE_ENV=production), not
  just `npm run dev`, or you won't see the breakage.

## Secrets / env

- No `NEXT_PUBLIC_*` secret, ever. `ANTHROPIC_API_KEY`, `DATABASE_URL`, `STRIPE_*`, `AUTH_*` are
  server-only. The product rule is that customers never see an AI key; don't leak one into the bundle.
- You don't need any env vars to build the marketing UI. `npm run build` works with none set.

## Positioning rules that affect copy (full list is in HANDOFF_2_UX_PRODUCT.md / project memory)

Quick reminders since they bite at the code level too: the AI is invisible (no "Claude," model names,
"AI-powered," or provider names in any customer-facing string — including `layout.tsx` metadata, OG
tags, alt text); never claim "secure"/"ASVS compliant" (say "posture against specific controls");
pricing is flat **$29/mo**.

## Temporary file you'll see on `main` (don't build on it)

`app/api/health/db/route.ts` is a **temporary, token-gated DB diagnostic** I added while fixing the
prod 500. It's password-safe and 404s without the token. It will be **deleted and redeployed** once
H1 is fully closed — so don't reference it, link to it, or be surprised when it disappears from a
future `git merge main`.

## Merge / worktree hygiene

- You're in a side-worktree off the same repo. To pick up this file (and the eventual health-route
  removal), `git merge main` (or rebase) into your branch.
- `main` may move under you (at minimum, the temporary health route gets removed). After any merge,
  re-run `npm run build` and `npm run typecheck` before continuing.
- Keep your changes to the frontend surface listed above; if a merge ever shows you touching
  `auth.ts`/`middleware.ts`/`db/**`/`lib/**`/`app/api/**`, that's a red flag to back out.

## Before you hand back — checklist

- [ ] `npm run build` passes with zero env vars set.
- [ ] `npm run typecheck` passes.
- [ ] No `NEXT_PUBLIC_*` secret introduced.
- [ ] If you added external assets: prod CSP updated, and verified under `npm start` (production mode).
- [ ] `/signin` still triggers the GitHub flow; `/dashboard` still renders its data; no `app/api/**`,
      `auth.ts`, `middleware.ts`, `db/**`, or `lib/**` logic changed.
- [ ] Customer-facing copy obeys the positioning rules (no AI/model names; no "secure"/"compliant").
