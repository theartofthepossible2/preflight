import Link from 'next/link';
import { auth } from '@/auth';

export default async function Home() {
  const session = await auth();

  return (
    <main>
      <header>
        <h1>Preflight</h1>
        <p className="tagline">
          A security gate for Next.js + Supabase/Neon projects. Runs as a GitHub Action on every push,
          posts a Check Run, and blocks Vercel deploys on HIGH findings via Vercel&apos;s native
          Deployment Checks.
        </p>
        <p className="disclaimer">
          Deterministic scanner produces the findings; an explanation layer grounded in OWASP ASVS 5.0
          tells your team why each one matters and how to fix it. Posture check against specific
          controls — <strong>not</strong> an ASVS compliance certification.
        </p>
      </header>

      <section className="uploader">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>How it works</h2>
        <ol style={{ paddingLeft: 18, margin: 0 }}>
          <li>Subscribe — flat $29/mo.</li>
          <li>Copy your <code>PREFLIGHT_API_KEY</code> and add it to your repo as a secret.</li>
          <li>
            Drop one workflow file (<code>.github/workflows/preflight.yml</code>) referencing the
            Preflight Action.
          </li>
          <li>
            In Vercel → Project → Deployment Checks, mark the Preflight check as required.
          </li>
        </ol>
        <div className="row" style={{ marginTop: 20 }}>
          {session ? (
            <Link href="/dashboard">
              <button type="button">Go to dashboard</button>
            </Link>
          ) : (
            <Link href="/signin">
              <button type="button">Sign in to get started</button>
            </Link>
          )}
        </div>
      </section>
    </main>
  );
}
