import Link from 'next/link';
import { signIn } from '@/auth';

interface SearchParams {
  callbackUrl?: string;
  error?: string;
}

function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} width={30} height={30} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.5 4.5 5.4v6.1c0 4.6 3.1 8 7.5 9.9 4.4-1.9 7.5-5.3 7.5-9.9V5.4L12 2.5Z"
        fill="currentColor"
        fillOpacity="0.12"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <path
        d="m8.4 12.2 2.5 2.5 4.7-5.1"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg className={className} width={18} height={18} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05A9.4 9.4 0 0 1 12 6.84c.85 0 1.71.12 2.51.34 1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { callbackUrl, error } = await searchParams;

  return (
    <div className="mkt flex min-h-screen flex-col bg-[radial-gradient(70%_55%_at_50%_0%,#eef4ff_0%,#ffffff_60%)] font-sans text-slate-700 antialiased">
      <div className="mx-auto flex w-full max-w-6xl items-center px-5 py-6 sm:px-8">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-slate-900">
          <span className="text-brand-600">
            <Logo />
          </span>
          <span className="text-[17px]">Preflight</span>
        </Link>
      </div>

      <div className="flex flex-1 items-center justify-center px-5 pb-24">
        <div className="w-full max-w-sm">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sign in to Preflight</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              Manage your subscription and API key, and review what the gate has caught.
            </p>

            {error && (
              <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
                Sign-in failed: {error}
              </div>
            )}

            <form
              className="mt-6"
              action={async () => {
                'use server';
                await signIn('github', { redirectTo: callbackUrl ?? '/dashboard' });
              }}
            >
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
              >
                <GitHubMark />
                Continue with GitHub
              </button>
            </form>

            <p className="mt-5 text-xs leading-relaxed text-slate-500">
              GitHub sign-in is identity only — it grants no access to your code. The scan runs in
              your own CI on your repository’s built-in{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-600">GITHUB_TOKEN</code>.
              One-click setup is optional: you separately authorize a scoped, per-repository GitHub
              App to write the workflow file and secret.
            </p>
          </div>

          <p className="mt-6 text-center text-sm text-slate-500">
            New here?{' '}
            <Link href="/#pricing" className="font-medium text-brand-700 hover:text-brand-800">
              See what Preflight does
            </Link>
          </p>
        </div>
      </div>

      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-5 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>&copy; {new Date().getFullYear()} Space. All rights reserved.</p>
          <nav className="flex items-center gap-4">
            <Link href="/terms" className="transition-colors hover:text-slate-700">
              Terms of Service
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-slate-700">
              Privacy Policy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
