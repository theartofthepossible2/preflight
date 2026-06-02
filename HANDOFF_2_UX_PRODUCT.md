# Handoff 2 — UX / marketing pass: make it feel like a real product

> **Goal for this chat:** the app currently has a bare-bones, functional UI. It does not sell the
> product. Build out the marketing/UX so a first-time visitor understands what Preflight is, why they
> need it, and how to start — without breaking the working auth/billing/dashboard underneath.
>
> **Prerequisite:** the deploy/auth fix (HANDOFF_1) should be done first, so you can see real state
> while iterating. If it isn't, you can still build UI locally with stubbed env vars (`npm run build`
> works with none set).

## What Preflight is (positioning — this is load-bearing)

A **security gate** for Next.js + Supabase/Neon projects. It runs as a GitHub Action on every push,
posts a Check Run, and blocks Vercel production deploys on HIGH findings via Vercel's native
Deployment Checks. A deterministic scanner produces the findings; an explanation layer grounded in
OWASP ASVS 5.0 says why each matters and how to fix it.

**Positioning rules (from project memory — do not violate in copy):**
- Sell it as a **security gate that blocks bad deploys**, NOT as "AI security review." The AI is an
  invisible implementation detail. Do **not** put model names, "Claude," "AI-powered," or provider
  names in customer-facing copy. The deterministic scanner is the product; the model explains.
- Never claim "secure" or "ASVS compliant." Language is "posture against specific controls,"
  "passed these checks / found these issues." Findings carry `definitive` vs `heuristic` confidence —
  preserve that honesty in any results UI.
- Pricing is flat **$29/mo**. One tier for now.
- Customers never see, paste, or manage an API key for AI. (They do manage a `PREFLIGHT_API_KEY` for
  the Action → backend auth — that's different and fine.)

## Current UI state (what exists)

- Dark theme, hand-rolled CSS in `app/globals.css` (CSS variables, no Tailwind, no component library).
- Three pages:
  - `app/page.tsx` — minimal landing: h1, tagline, a 4-step "how it works" list, one CTA button.
  - `app/signin/page.tsx` — single "Continue with GitHub" button.
  - `app/dashboard/page.tsx` + `dashboard-client.tsx` — subscription state, API-key CRUD, recent
    scans table, an Action-install snippet. **This works — don't regress it.**
- It's correct and functional but reads like a dev tool's debug page, not a product.

## The gap to close

There isn't enough here to convince a visitor to subscribe. Needs (suggested, prioritize with user):

1. **Hero** — one-line value prop + subhead + primary CTA. The promise: "Stop shipping security
   regressions. Preflight blocks the deploy before they reach production." (workshop the exact words.)
2. **The problem / why** — the gap Preflight fills: security checks usually run *after* deploy, or
   never. Preflight makes "commit → push → check → gate" literally true.
3. **How it works** — the pipeline visual: push → GitHub Action runs scanner → findings explained →
   Check Run → Vercel holds production promotion until it passes. (There's an ASCII version in
   `README.md` to adapt.)
4. **What it checks** — the four deterministic checks (secret exposure, Supabase RLS posture,
   unprotected server entry points, security headers), framed as outcomes not regexes.
5. **Pricing** — a real pricing card: $29/mo, what's included, the lapse behavior ("the gate keeps
   running even if you lapse; you just lose the explanations") as a trust signal.
6. **Trust signals** — this is a *security* product; trust is the whole sale. Consider: a sample
   findings report, the "we don't store your code" property (the Action runs the scan in the
   customer's CI; only findings + small snippets reach the backend), the dogfooding angle
   (Preflight runs on Preflight). No fake logos/testimonials.
7. **FAQ** — "Does my code leave my CI?", "What if I don't pay?", "Does this replace a pentest?"
   (answer: no — it's a posture gate, not a certification), "Which stacks?"
8. **Footer** — links, contact, eventual legal/privacy (privacy matters: finding snippets can contain
   secrets; be honest about what's sent to the backend).
9. **Install/docs page** — expand the dashboard's Action snippet into a real getting-started flow.

## Decisions to put to the user before building

- **CSS approach:** keep hand-rolled CSS, or adopt Tailwind (+ maybe shadcn/ui) for faster, more
  polished marketing components? Recommend asking — it's a meaningful dependency/architecture choice.
- **Light vs dark** (or both) for the marketing surface. Dashboard can stay dark.
- **Copy tone:** developer-direct vs. enterprise-trust. For a security gate sold to dev teams,
  developer-direct with concrete specifics tends to convert better than vague enterprise language.
- **Brand/domain:** still on `preflight-seven.vercel.app`. A real domain (`.com`/`.dev`/`.security`)
  is an open decision and affects logo/wordmark/OG tags. `.space` was abandoned (Safe Browsing flag).

## Constraints / don't-break list

- Keep `/dashboard`, `/signin`, all `/api/*` routes, `auth.ts`, `middleware.ts` working. The
  marketing work is additive/restyling, not a rebuild of the working backend.
- The `middleware.ts` basic-auth preview gate is active when `PREVIEW_USERNAME`/`PREVIEW_PASSWORD`
  are set — marketing pages sit behind it during preview, which is fine.
- Production security headers (CSP/HSTS) come from `next.config.ts` and only apply in prod; if you add
  external assets (fonts, images, analytics), update the CSP `connect-src`/`img-src`/`font-src` or
  they'll be blocked in production. (Dev uses a relaxed header set — see `next.config.ts`.)
- Don't introduce client-side env exposure: nothing AI/secret-related should ever be `NEXT_PUBLIC_`.

## Useful context

- Stack: Next.js 15 App Router + TypeScript. Plain CSS today (`app/globals.css`).
- Read project memory first (persists across chats) — it has the full product vision, the COGS model,
  the "AI is invisible" rule, and the domain history. Don't relitigate decisions recorded there.
- `PREFLIGHT_HANDOFF.md` (original v0.2 spec) and `README.md` (current v0.3 architecture) are the
  best background reads.
