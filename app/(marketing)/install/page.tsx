import type { Metadata } from 'next';
import Link from 'next/link';
import { WORKFLOW_YAML } from '@/lib/github/workflow-template';
import { IconArrowRight, IconLock } from '../_components/icons';

export const metadata: Metadata = {
  title: 'Setup — Preflight',
  description:
    'Get Preflight gating your deploys in four steps: subscribe, add a repo secret, drop in one workflow file, and mark the check as required in Vercel.',
};

const steps = [
  {
    title: 'Subscribe and grab your key',
    body: (
      <>
        <p>
          Sign in with GitHub and start your subscription — flat $29/mo. In the dashboard, create a
          key; it’s shown once, so copy it right away.
        </p>
        <Link
          href="/signin"
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
        >
          Go to the dashboard
          <IconArrowRight width={16} height={16} />
        </Link>
      </>
    ),
  },
  {
    title: 'Add the repo secret',
    body: (
      <>
        <p>
          In your repository, go to{' '}
          <span className="font-medium text-slate-800">
            Settings → Secrets and variables → Actions → New repository secret
          </span>
          . Name it exactly:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-sm text-slate-100">
          <code>PREFLIGHT_API_KEY</code>
        </pre>
        <p className="mt-3 text-sm text-slate-500">
          This is the only key you ever manage — it lets the Action talk to Preflight. There is no
          model or provider credential to supply.
        </p>
      </>
    ),
  },
  {
    title: 'Add the workflow file',
    body: (
      <>
        <p>
          Commit this to <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">.github/workflows/preflight.yml</code>:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-[13px] leading-relaxed text-slate-100">
          <code>{WORKFLOW_YAML.trimEnd()}</code>
        </pre>
        <p className="mt-3 text-sm text-slate-500">
          Vercel fires this workflow when it finishes a production build. The scanner runs in your CI
          and posts a GitHub check named{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">preflight</code>{' '}
          — that’s the check you’ll require in the next step.
        </p>
      </>
    ),
  },
  {
    title: 'Require the check in Vercel',
    body: (
      <>
        <p>
          In Vercel, open{' '}
          <span className="font-medium text-slate-800">
            Project → Settings → Deployment Checks → Add Checks
          </span>
          . Select the{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">preflight</code>{' '}
          check — Vercel auto-discovers it from the workflow above, and its name comes from GitHub
          (it isn’t editable here). Require it for Production and save.
        </p>
        <p className="mt-3">
          That’s the gate. On every production deploy Vercel waits for{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">preflight</code>; a
          HIGH finding fails the run, the check goes red, and the promotion is held.
        </p>
      </>
    ),
  },
];

export default function Install() {
  return (
    <>
      <section className="border-b border-slate-200 bg-[radial-gradient(60%_60%_at_50%_0%,#eef4ff_0%,#ffffff_70%)]">
        <div className="mx-auto max-w-3xl px-5 pb-14 pt-16 text-center sm:px-8 sm:pt-20">
          <span className="inline-block text-sm font-semibold uppercase tracking-wider text-brand-600">
            Setup guide
          </span>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Gating your deploys in four steps
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
            One workflow file, one secret, one toggle in Vercel. Most teams are done in a few
            minutes.
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-20">
          <ol className="space-y-5">
            {steps.map((step, i) => (
              <li
                key={step.title}
                className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-7"
              >
                <div className="flex items-center gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
                    {i + 1}
                  </span>
                  <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                    {step.title}
                  </h2>
                </div>
                <div className="mt-4 space-y-1 pl-0 text-[15px] leading-relaxed text-slate-600 sm:pl-13">
                  {step.body}
                </div>
              </li>
            ))}
          </ol>

          {/* Privacy callout */}
          <div className="mt-8 flex gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-700 ring-1 ring-slate-200">
              <IconLock width={20} height={20} />
            </span>
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                What actually leaves your CI
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                The scanner runs on your runner against your checked-out code. Your source is never
                uploaded. When findings exist, only those findings — plus a few lines of context
                around each — are sent to Preflight for explanation. A flagged secret’s snippet can
                contain the secret itself, so those are not stored long-term.
              </p>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-slate-500">Ready to put a gate in front of production?</p>
            <Link
              href="/signin"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              Get started — $29/mo
              <IconArrowRight width={18} height={18} />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
