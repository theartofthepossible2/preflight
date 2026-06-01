# Preflight — Build Handoff (v0.2: Vercel-hosted, AI-augmented ASVS posture check)

> **For the build agent:** This document is the spec. Build exactly what's in scope, respect the
> non-negotiable principles, and use the defaults in §9 unless the project owner says otherwise.
> A working reference implementation of the deterministic checks already exists as `preflight.mjs`
> — include it in the repo and port its logic (see §4). When in doubt about Anthropic API
> specifics (model IDs, request shape), confirm against the live docs rather than guessing:
> https://docs.claude.com/en/api/overview

---

## 0. What you're building (one paragraph)

A small web app, hosted on Vercel, that takes a Next.js + Supabase/Neon project as input, runs a set
of **deterministic security checks** over its source, then uses the **Anthropic API** to cross-reference
each finding against the **OWASP ASVS 5.0** standard and produce a plain-language explanation plus a
concrete fix. Output is a ranked list of findings shown in a minimal UI (and available as JSON). This is
an *upgrade of the existing `preflight.mjs` CLI* into a hosted, AI-augmented service — not a rewrite.

---

## 1. Non-negotiable principles (product guardrails — do not violate)

These are load-bearing for the product. Encode them in code and copy, not just intent.

1. **Deterministic findings are the backbone; the AI is an enrichment layer.** The scanner produces the
   findings. The model *explains and contextualizes* them — it does not decide whether they exist on its
   own. If the Anthropic API call fails or times out, the app must still return the deterministic findings.
   The AI is never a hard dependency for the core result.
2. **Ground the model in the findings, never ask it cold.** Do not send "is this app secure?" to the model.
   Send: the specific finding + the relevant code snippet + the relevant ASVS requirement, and ask it to
   confirm/contextualize and remediate. Ungrounded model judgments about security are unreliable and are
   exactly what this product cannot ship.
3. **Never claim "secure" or "ASVS compliant."** The product reports *posture against specific controls*.
   Output language is "passed these checks / found these issues," never a compliance certification.
   Findings already carry a `confidence` tag of `definitive` or `heuristic` — preserve it and surface it.
4. **Preflight must be exemplary about its own security** (see §8). A security tool that leaks its own
   API key is self-refuting. The Anthropic key is server-side only, never `NEXT_PUBLIC_`.

---

## 2. Architecture (this version)

```
  project input              server-side (Vercel)                         response
 ┌──────────────┐    ┌──────────────────────────────────────────┐    ┌───────────────┐
 │ zip upload   │ ─► │ 1. Scanner  (port of preflight.mjs)        │    │ ranked        │
 │ (see §6)     │    │      → deterministic findings[]            │    │ findings, each│
 └──────────────┘    │ 2. ASVS reference data (curated 5.0 subset)│ ─► │ with ASVS ref │
                     │ 3. Anthropic analysis layer (batched)      │    │ + explanation │
                     │      → enriches each finding               │    │ + fix         │
                     │ 4. Merge + rank                            │    │ (UI + JSON)   │
                     └──────────────────────────────────────────┘    └───────────────┘
```

Two clean layers, matching the principles: **(scanner = facts)** then **(model = explanation grounded in
those facts + ASVS)**. Keep them as separate modules so the scanner can later be swapped for the
connectivity-graph engine without touching the analysis layer.

---

## 3. Tech stack & hosting

- **Framework:** Next.js (App Router) + TypeScript. Native fit for Vercel.
- **Hosting:** Vercel.
- **AI:** Anthropic Messages API via the official SDK `@anthropic-ai/sdk`. Server-side only.
- **Model:** default to `claude-sonnet-4-6` (good reasoning at moderate cost for this analysis workload).
  `claude-haiku-4-5` if cost is the priority; an Opus model for hardest analysis later. **Confirm the
  current model IDs at https://docs.claude.com/en/api/overview before shipping.**
- **No database** for this version (stateless: scan → show → forget). See §9 / §10.
- **No user accounts** for this version.

---

## 4. The reusable kernel (port from `preflight.mjs`)

The existing CLI is the source of truth for the deterministic checks. Port its logic into a server-side
`scanner` module that takes an in-memory map of `{ filepath: contents }` and returns `findings[]`.

### 4a. Finding schema (keep this shape — the UI, JSON output, and AI layer all depend on it)

```ts
type Severity = 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
type Confidence = 'definitive' | 'heuristic';

interface Finding {
  id: string;            // stable id, e.g. `${check}:${file}:${line}` — needed to join AI output back
  severity: Severity;
  confidence: Confidence;
  asvsCategory: string;  // category-level mapping for now (see §5b)
  title: string;
  file: string;
  line: number | null;
  detail: string;        // what the scanner observed
  codeSnippet?: string;  // a few lines of context around the finding — feeds the AI layer
}
```

### 4b. The four checks to port (all deterministic, source-only)

1. **Secret exposure** — `NEXT_PUBLIC_` env vars carrying secrets (HIGH if `SERVICE_ROLE`/`SECRET`/
   `PASSWORD`/`PRIVATE`, MEDIUM for generic `_KEY`/`_TOKEN`); `service_role` referenced in a `'use client'`
   file; hardcoded `postgres://user:pass@…` connection strings. **Do not flag** anon/publishable keys —
   they're public by design.
2. **Supabase RLS posture** (from `.sql` migrations) — tables created without a matching
   `enable row level security`; policies that are effectively `using (true)` / `with check (true)`.
   If no SQL migrations exist, emit an INFO note that DB authorization couldn't be verified from source.
3. **Unprotected server entry points** (HEURISTIC) — Next route handlers (`app/**/route.ts`), API routes
   (`pages/api/**`), and server actions (`'use server'`) that perform data access but have no detectable
   auth check (`getUser`/`getSession`/`requireUser`/etc.) on their path. Note if a middleware auth guard
   exists project-wide (it may or may not cover the route — hence heuristic).
4. **Security headers** — `next.config.*` with no `headers()` / CSP / HSTS configured.

Port the exact regexes and tier logic from `preflight.mjs`; they're already validated against a fixture
with both vulnerable and correctly-secured cases (and tuned to avoid false positives, which is critical).

---

## 5. Build it in these components

### 5a. Scanner module — `lib/scanner/`
Port of §4. Input: `Record<string, string>` (filepath → contents). Output: `Finding[]`. Pure, no I/O,
no network — easy to unit test. Reuse `preflight.mjs`'s ignore-list and file-type filtering.

### 5b. ASVS reference data — `lib/asvs/asvs-5.0.json`
Ingest a **curated subset** of OWASP ASVS 5.0 requirements covering the categories the checks touch
(Authorization & Access Control, Configuration & Secret Management, Security Configuration). Source CSV:
asvs.dev (the official machine-readable export). Each entry: `{ id, chapter, section, title, text }`.
Map each `asvsCategory` on a finding to the specific requirement(s) so the AI layer can cite exact IDs
(e.g. `v5.0.0-…`). *Upgrade later:* expand to the full standard and tighten finding→requirement mapping.

### 5c. Anthropic analysis layer — `lib/analyze/` (SERVER-SIDE ONLY)
- One **batched** request per scan: send all findings together (not one call per finding — control cost
  and latency). Include for each finding: `id`, `title`, `detail`, `severity`, `confidence`, `codeSnippet`,
  and the matched ASVS requirement text.
- **System prompt** must instruct the model to:
  - Return **only JSON** matching the output schema below (no prose, no markdown fences).
  - Work strictly from the findings provided; explain each in terms of the cited ASVS requirement.
  - Give concrete, stack-specific remediation (Next.js / Supabase / Neon).
  - Be honest about uncertainty for `heuristic` findings (it can't see the full call graph yet).
  - It MAY add `additionalObservations` for issues visible in the snippets that the scanner missed —
    but these must be clearly marked as model-inferred and lower confidence. (This is the seed of the
    semantic/intent layer; keep it bounded.)
- **Parse defensively:** strip any code fences, `JSON.parse` in try/catch. *Recommended robustness upgrade:*
  use Anthropic **tool use** to force the output schema instead of free-form JSON.
- **Degrade gracefully:** on API error/timeout, return the deterministic findings with a flag like
  `aiEnrichment: 'unavailable'`. Never 500 the whole scan because the model call failed (Principle 1).

#### Analysis output schema (per finding)
```ts
interface AnalyzedFinding extends Finding {
  asvsRequirement: { id: string; title: string };
  isLikelyRealIssue: 'high' | 'medium' | 'low';   // model's confidence it's a true positive
  explanation: string;                              // why it matters, in ASVS terms, plain language
  remediation: string[];                            // ordered, concrete steps
  codeFixExample?: string;                          // optional snippet
}
// Plus top-level: additionalObservations?: { description, severity, confidence: 'model-inferred' }[]
```

### 5d. API route — `app/api/scan/route.ts`
Receives the project input (§6), runs scanner → matches ASVS → calls analysis layer → returns the merged
`AnalyzedFinding[]` + counts + the standard disclaimer string. Enforce an **input size cap** and basic
**rate limiting** (this is a public demo on the operator's API key — see §8).

### 5e. Minimal UI — `app/page.tsx`
Submit a project (§6) → show findings ranked worst-first, each with severity badge, `definitive`/`heuristic`
tag, ASVS id, the explanation, and the fix steps. Show the summary counts and the "posture check, not
certification" disclaimer. Keep it simple; visual polish is not the goal of this version.

---

## 6. Input method — **KEY OPEN DECISION** (recommended default below)

A hosted scanner needs the project's code somehow. Options:

| Option | Pros | Cons |
|---|---|---|
| **A. Zip upload** *(recommended v1)* | Works for private code with no OAuth; all in-memory; fits serverless | User has to produce a zip |
| B. Public GitHub URL | Frictionless for OSS | Public repos only without auth; needs fetch+unzip of a tarball |
| C. GitHub App | Real "connect" UX, runs on push | Heavier; OAuth + webhook infra |
| D. Paste files | Trivial | Clunky for a whole repo |

**Default for this build: A (zip upload).** Accept a `.zip`, unzip in-memory server-side, build the
`{filepath: contents}` map, run the scan. (B is a good fast-follow.) The richer "connect via OAuth /
GitHub App / live infra" path is **out of scope** here — see §10.

---

## 7. Data contracts

- **Request (zip upload):** `multipart/form-data` with the project zip; server caps total uncompressed size.
- **Response:** `{ version, scanned: {files, code, sql}, counts: {HIGH,MEDIUM,LOW,INFO}, findings: AnalyzedFinding[], aiEnrichment: 'ok' | 'unavailable', disclaimer: string }`

---

## 8. Security of Preflight itself (dogfooding — non-optional)

- `ANTHROPIC_API_KEY` lives in Vercel **server** env vars only. **Never** `NEXT_PUBLIC_`. Never reaches the client.
- All Anthropic calls happen in route handlers / server code, never the browser.
- Public demo on the operator's key → add an input-size cap and a simple per-IP rate limit to prevent
  someone running up the API bill. (BYO-key is the longer-term answer; out of scope here.)
- Don't persist uploaded code (stateless). If you must buffer to a temp path, clean it up.
- Run Preflight on Preflight before shipping.

---

## 9. Open decisions (defaults assumed — confirm or redirect)

The build can proceed on these defaults; flagging them so they're chosen, not stumbled into:

1. **Input method** → default **zip upload** (§6). *This is the one most worth confirming.*
2. **Accounts/auth** → default **none** (anonymous, open demo).
3. **Persistence** → default **none** (stateless scan).
4. **Whose API key** → default **operator's key** server-side (not BYO-key yet).
5. **Model** → default **`claude-sonnet-4-6`** (confirm current ID in docs).
6. **Check scope** → default **the four checks from `preflight.mjs`** only; no new check types this version.
7. **Output** → default **web UI + JSON response**.

---

## 10. Explicit non-goals for this version (do NOT build these yet)

- The full connectivity / code-property graph (TS-compiler-based call-graph analysis). *Next milestone.*
- Live full-stack connection: connecting to the running Supabase/Neon DB or the Vercel API to read
  *actual* (not source-declared) config. *Next phase.*
- User accounts, billing, BYO-key flows, the "badge"/attestation, persistence, dashboards.
- The trained/fine-tuned proprietary model. (Use the base Anthropic model only.)

Keeping these out is deliberate — it's how this stays a shippable first version.

---

## 11. What comes next (build in this direction)

The deliberate seam in this version is the **heuristic** entry-point check, which can't yet verify whether
a guard actually covers a route. The next milestone replaces the regex scanner with a **connectivity graph**
built via the TypeScript compiler (ts-morph): follow each entry point's calls to the data it touches and
the guard that does/doesn't protect it. That graph becomes (a) the substrate the deterministic checks and
the AI layer both read, and (b) the data behind a future "see your whole stack" visualization. **Design the
scanner module's interface so it can be swapped for the graph engine without changing the analysis layer.**

---

## Appendix: env vars & suggested structure

```
ANTHROPIC_API_KEY=...          # server-side only, NOT NEXT_PUBLIC_

/app
  page.tsx                     # upload UI + results
  /api/scan/route.ts           # orchestrates scan → asvs → analyze
/lib
  /scanner/                    # port of preflight.mjs (pure)
  /asvs/asvs-5.0.json          # curated ASVS 5.0 subset
  /analyze/                    # Anthropic analysis layer (server-only)
  /types.ts                    # Finding, AnalyzedFinding
preflight.mjs                  # reference implementation (kept in repo)
```
