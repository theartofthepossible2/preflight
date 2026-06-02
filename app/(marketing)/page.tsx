import type { Metadata } from 'next';
import Link from 'next/link';
import {
  IconArrowRight,
  IconCheck,
  IconX,
  IconKey,
  IconDatabase,
  IconDoor,
  IconShieldHalf,
  IconBraces,
  IconLock,
  IconGauge,
  IconGitBranch,
} from './_components/icons';

export const metadata: Metadata = {
  title: 'Preflight — block insecure deploys before they ship',
  description:
    'A security gate for Next.js + Supabase / Neon projects. Preflight runs on every push, checks your code against critical security controls, and holds the production deploy until it passes.',
};

function Eyebrow({ children, light }: { children: React.ReactNode; light?: boolean }) {
  return (
    <span
      className={
        light
          ? 'inline-block text-sm font-semibold uppercase tracking-wider text-brand-300'
          : 'inline-block text-sm font-semibold uppercase tracking-wider text-brand-600'
      }
    >
      {children}
    </span>
  );
}

function SectionHeading({
  eyebrow,
  title,
  blurb,
  light,
}: {
  eyebrow: string;
  title: string;
  blurb?: string;
  light?: boolean;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <Eyebrow light={light}>{eyebrow}</Eyebrow>
      <h2
        className={`mt-3 text-3xl font-bold tracking-tight sm:text-4xl ${
          light ? 'text-white' : 'text-slate-900'
        }`}
      >
        {title}
      </h2>
      {blurb ? (
        <p className={`mt-4 text-lg leading-relaxed ${light ? 'text-slate-400' : 'text-slate-600'}`}>
          {blurb}
        </p>
      ) : null}
    </div>
  );
}

function ConfidenceTag({ kind }: { kind: 'definitive' | 'heuristic' }) {
  const styles =
    kind === 'definitive'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
      : 'bg-amber-50 text-amber-700 ring-amber-600/20';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${styles}`}
    >
      {kind}
    </span>
  );
}

const checks = [
  {
    icon: IconKey,
    title: 'Exposed secrets',
    confidence: 'definitive' as const,
    body: 'Service-role keys in NEXT_PUBLIC_ vars, server credentials imported into "use client" files, and connection strings with passwords baked in — caught before they reach a browser bundle.',
  },
  {
    icon: IconDatabase,
    title: 'Database authorization',
    confidence: 'definitive' as const,
    body: 'Supabase tables created without row-level security, and policies that effectively allow everyone — the using (true) escape hatch that quietly opens your data to the world.',
  },
  {
    icon: IconDoor,
    title: 'Unprotected entry points',
    confidence: 'heuristic' as const,
    body: 'Route handlers, API routes, and server actions that read or write data with no authentication check on their path. Flagged as heuristic — we tell you when we can’t be certain.',
  },
  {
    icon: IconShieldHalf,
    title: 'Security headers',
    confidence: 'definitive' as const,
    body: 'A missing or empty header configuration — no Content-Security-Policy, no HSTS — in your Next.js config, leaving the app open to clickjacking and content-type attacks.',
  },
];

const pipeline = [
  {
    icon: IconGitBranch,
    title: 'You push',
    body: 'A GitHub Action runs on every push and pull request, against the code already checked out in your own CI.',
  },
  {
    icon: IconGauge,
    title: 'Preflight scans',
    body: 'A deterministic scanner inspects the source for known security regressions. No tokens, no access to your repo — and your code never leaves the runner.',
  },
  {
    icon: IconBraces,
    title: 'Findings explained',
    body: 'Each finding gets a plain-language explanation grounded in OWASP ASVS 5.0: what it is, why it matters, and exactly how to fix it.',
  },
  {
    icon: IconCheck,
    title: 'A Check Run posts',
    body: 'Results come back as a standard GitHub Check Run. HIGH findings fail the check, right where your team already looks.',
  },
  {
    icon: IconLock,
    title: 'The deploy waits',
    body: 'Mark Preflight as required in Vercel’s native Deployment Checks, and production promotion is held until the check passes.',
  },
];

const faqs = [
  {
    q: 'Does my source code leave my CI?',
    a: 'No. The scanner runs inside your CI, on your own runner, against your checked-out code. Only the findings — plus a few lines of context around each one — are sent to Preflight for explanation. For a flagged secret that snippet can contain the secret itself, so we don’t store these long-term.',
  },
  {
    q: 'What happens if I stop paying?',
    a: 'The gate keeps running and keeps passing. You lose the explanations, not the pipeline. Preflight never fails a deploy over billing — an expired card should never block your release.',
  },
  {
    q: 'Does this replace a penetration test or a security audit?',
    a: 'No. Preflight is a deploy-time gate against specific, well-defined controls — it catches regressions before they ship. It is not a certification and it never claims your app is "secure." Keep your audits; this stops the obvious things from reaching production in the first place.',
  },
  {
    q: 'Which stacks does it support?',
    a: 'Next.js (App Router or Pages) deployed on Vercel, with Supabase or Neon Postgres. That’s the stack the checks are tuned for today.',
  },
  {
    q: 'Do I have to manage any API keys?',
    a: 'Just one: a PREFLIGHT_API_KEY repo secret so the Action can talk to the Preflight backend. There’s nothing else to configure and no model or provider credential to supply.',
  },
  {
    q: 'How does it actually block the deploy?',
    a: 'It posts a normal GitHub Check Run. You mark that check as required in Vercel’s Deployment Checks settings, and Vercel holds production promotion until the check passes — no marketplace integration required.',
  },
];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-slate-200">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_0%,#eef4ff_0%,#ffffff_70%)]"
        />
        <div className="mx-auto max-w-6xl px-5 pb-20 pt-16 sm:px-8 sm:pb-28 sm:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              Security gate for Next.js + Supabase / Neon
            </span>
            <h1 className="mt-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl">
              Stop shipping security regressions to production.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600 sm:text-xl">
              Preflight checks every push against critical security controls and holds the
              production deploy until it passes — inside the GitHub and Vercel pipeline you already
              use.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/signin"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 sm:w-auto"
              >
                Get started — $29/mo
                <IconArrowRight width={18} height={18} />
              </Link>
              <Link
                href="/install"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-800 transition-colors hover:bg-slate-50 sm:w-auto"
              >
                See setup
              </Link>
            </div>
            <p className="mt-5 text-sm text-slate-500">
              Your code never leaves your CI · Cancel anytime
            </p>
          </div>

          {/* Hero panel: the gate in action */}
          <div className="mx-auto mt-16 max-w-2xl">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                <span className="ml-2 text-xs font-medium text-slate-400">
                  github.com · deploy checks
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <IconGitBranch width={18} height={18} className="text-slate-400" />
                  <span className="text-sm text-slate-600">
                    Push <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">3f9a2c1</code> to <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">main</code>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                      <IconX width={13} height={13} />
                    </span>
                    <span className="text-sm font-medium text-slate-800">Preflight / security-gate</span>
                  </div>
                  <span className="rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-600 ring-1 ring-inset ring-rose-600/20">
                    1 HIGH finding
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 bg-amber-50/40 px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                      <IconLock width={12} height={12} />
                    </span>
                    <span className="text-sm font-medium text-slate-800">Production deploy</span>
                  </div>
                  <span className="text-xs font-semibold text-amber-700">Blocked — waiting for checks</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem / why */}
      <section className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <SectionHeading
            eyebrow="The problem"
            title="Security checks run too late — or never"
            blurb="Most review happens after the code is already in production: a quarterly audit, a pentest, an incident page at 2am. By then the regression has shipped. Preflight moves the check left, into the push."
          />
          <div className="mx-auto mt-12 grid max-w-4xl gap-5 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Without a gate
              </h3>
              <ul className="mt-4 space-y-3">
                {[
                  'Findings arrive after deploy, in a report nobody reads.',
                  'A risky change merges because review is manual and optional.',
                  'Exposed secrets and open endpoints reach prod before anyone notices.',
                ].map((t) => (
                  <li key={t} className="flex gap-3 text-sm text-slate-600">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                      <IconX width={13} height={13} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-brand-200 bg-white p-6 shadow-sm ring-1 ring-brand-600/5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-600">
                With Preflight
              </h3>
              <ul className="mt-4 space-y-3">
                {[
                  'The check runs on every push, automatically — commit, push, check, gate.',
                  'HIGH findings fail the check and hold production promotion.',
                  'Each issue is explained in plain language, right in the pull request.',
                ].map((t) => (
                  <li key={t} className="flex gap-3 text-sm text-slate-700">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                      <IconCheck width={13} height={13} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-20 bg-ink-900">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <SectionHeading
            light
            eyebrow="How it works"
            title="Commit → push → check → gate"
            blurb="Five steps, all inside tools you already run. Nothing new to host."
          />
          <ol className="mx-auto mt-14 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {pipeline.map((step, i) => {
              const Icon = step.icon;
              return (
                <li
                  key={step.title}
                  className="relative rounded-2xl border border-ink-600 bg-ink-800 p-5"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600/15 text-brand-300">
                      <Icon width={18} height={18} />
                    </span>
                    <span className="text-xs font-semibold text-slate-500">
                      Step {i + 1}
                    </span>
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-white">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{step.body}</p>
                </li>
              );
            })}
          </ol>
          <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-slate-500">
            The scanner runs in your CI on your runner. Only the findings — and a few lines of
            context around each — are sent to Preflight for explanation.
          </p>
        </div>
      </section>

      {/* What it checks */}
      <section id="checks" className="scroll-mt-20 border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <SectionHeading
            eyebrow="What it checks"
            title="Four checks that catch what actually ships"
            blurb="Not a generic linter. Each check targets a specific way Next.js + Supabase / Neon apps leak data or expose themselves."
          />
          <div className="mt-12 grid gap-5 sm:grid-cols-2">
            {checks.map((c) => {
              const Icon = c.icon;
              return (
                <div
                  key={c.title}
                  className="rounded-2xl border border-slate-200 bg-white p-6 transition-shadow hover:shadow-md hover:shadow-slate-900/5"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                      <Icon width={22} height={22} />
                    </span>
                    <ConfidenceTag kind={c.confidence} />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-slate-900">{c.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{c.body}</p>
                </div>
              );
            })}
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-slate-500">
            Every finding is tagged <span className="font-medium text-emerald-700">definitive</span>{' '}
            or <span className="font-medium text-amber-700">heuristic</span> — verified versus
            inferred — so you always know how much to trust it.
          </p>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <SectionHeading
            eyebrow="Pricing"
            title="One plan. Flat $29 a month."
            blurb="No seats to count, no usage tiers to forecast. One price, the whole gate."
          />
          <div className="mx-auto mt-12 max-w-md">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
              <div className="border-b border-slate-100 p-7 text-center">
                <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">
                  Preflight
                </p>
                <p className="mt-3">
                  <span className="text-5xl font-bold tracking-tight text-slate-900">$29</span>
                  <span className="text-base font-medium text-slate-500">/month</span>
                </p>
              </div>
              <div className="p-7">
                <ul className="space-y-3.5">
                  {[
                    'Runs on every push, across your repos',
                    'All four checks on every pull request and deploy',
                    'Plain-language fixes grounded in OWASP ASVS 5.0',
                    'Blocks production promotion via Vercel Deployment Checks',
                    'Setup in minutes — one workflow file, one secret',
                  ].map((t) => (
                    <li key={t} className="flex gap-3 text-sm text-slate-700">
                      <IconCheck width={18} height={18} className="mt-0.5 shrink-0 text-brand-600" />
                      {t}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/signin"
                  className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
                >
                  Get started
                  <IconArrowRight width={18} height={18} />
                </Link>
              </div>
            </div>
            <p className="mx-auto mt-6 max-w-md text-center text-sm leading-relaxed text-slate-500">
              Cancel anytime. If your subscription lapses, the gate keeps running and keeps passing —
              you only lose the explanations. Preflight never fails your deploy over billing.
            </p>
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <SectionHeading
            eyebrow="Why trust it"
            title="A security tool has to earn trust"
            blurb="So here is exactly how Preflight handles your code, and where it draws the line on what it claims."
          />
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {[
              {
                icon: IconLock,
                title: 'Your code stays in your CI',
                body: 'The scanner runs on your own runner against your checked-out code. Only findings and a few lines of context are sent for explanation — and secret snippets are not stored long-term.',
              },
              {
                icon: IconShieldHalf,
                title: 'We run Preflight on Preflight',
                body: 'The same gate guards this product’s own deploys. We would not ask you to trust a check we don’t run on ourselves.',
              },
              {
                icon: IconGauge,
                title: 'Honest confidence, no theater',
                body: 'Findings are labeled definitive or heuristic, and we report posture against specific controls — never a "you’re secure" or "compliant" stamp we can’t back up.',
              },
            ].map((c) => {
              const Icon = c.icon;
              return (
                <div key={c.title} className="rounded-2xl border border-slate-200 bg-white p-6">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white">
                    <Icon width={22} height={22} />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold text-slate-900">{c.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{c.body}</p>
                </div>
              );
            })}
          </div>

          {/* Sample finding */}
          <div className="mx-auto mt-12 max-w-3xl">
            <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-400">
              Example finding
            </p>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-5">
                <span className="rounded-md bg-rose-600 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
                  High
                </span>
                <h3 className="flex-1 text-base font-semibold text-slate-900">
                  Service-role key exposed to the client
                </h3>
                <ConfidenceTag kind="definitive" />
              </div>
              <div className="space-y-4 p-5 text-sm">
                <p className="font-mono text-xs text-slate-500">
                  app/components/Upload.tsx:14 · ASVS V14.3.2
                </p>
                <p className="leading-relaxed text-slate-600">
                  A <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">NEXT_PUBLIC_</code>{' '}
                  environment variable carries the Supabase service-role key. Anything prefixed{' '}
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">NEXT_PUBLIC_</code>{' '}
                  is inlined into the browser bundle, handing every visitor full, RLS-bypassing
                  access to your database.
                </p>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Fix
                  </p>
                  <p className="mt-1 leading-relaxed text-slate-600">
                    Rename to a server-only variable (drop the <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">NEXT_PUBLIC_</code> prefix),
                    read it only in server code, and rotate the leaked key.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-3xl px-5 py-20 sm:px-8 sm:py-28">
          <SectionHeading eyebrow="FAQ" title="Questions, answered" />
          <div className="mt-10 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {faqs.map((f) => (
              <details key={f.q} className="group px-6 [&_summary]:list-none">
                <summary className="flex cursor-pointer items-center justify-between gap-4 py-5 text-left text-base font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span className="shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-45">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M12 5v14M5 12h14"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                </summary>
                <p className="pb-5 text-sm leading-relaxed text-slate-600">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-brand-600">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Put a gate in front of production.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-brand-100">
              One workflow file, one secret, one toggle in Vercel. Then the check runs on every push
              and the risky deploys stop on their own.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/signin"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-6 py-3 text-base font-semibold text-brand-700 shadow-sm transition-colors hover:bg-brand-50 sm:w-auto"
              >
                Get started — $29/mo
                <IconArrowRight width={18} height={18} />
              </Link>
              <Link
                href="/install"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/30 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-white/10 sm:w-auto"
              >
                Read the setup guide
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
