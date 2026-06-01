import { signIn } from '@/auth';

interface SearchParams {
  callbackUrl?: string;
  error?: string;
}

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { callbackUrl, error } = await searchParams;

  return (
    <main>
      <header>
        <h1>Sign in</h1>
        <p className="tagline">Sign in with GitHub to manage your subscription and API keys.</p>
      </header>

      {error && <div className="error">Sign-in failed: {error}</div>}

      <section className="uploader">
        <form
          action={async () => {
            'use server';
            await signIn('github', { redirectTo: callbackUrl ?? '/dashboard' });
          }}
        >
          <button type="submit">Continue with GitHub</button>
        </form>
        <p className="hint">
          GitHub is used for sign-in only. Preflight does not request repo access from your account —
          the GitHub Action runs inside your own CI with your repo&apos;s built-in
          <code> GITHUB_TOKEN</code>.
        </p>
      </section>
    </main>
  );
}
