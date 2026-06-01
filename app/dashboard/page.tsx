import { desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/db';
import { scans } from '@/db/schema';
import { listKeys } from '@/lib/apiKey';
import { getSubscriptionState } from '@/lib/stripe';
import { signOutAction } from './actions';
import { ApiKeyManager, BillingButtons } from './dashboard-client';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/dashboard');

  const [subscription, keys, recentScans] = await Promise.all([
    getSubscriptionState(session.user.id),
    listKeys(session.user.id),
    db
      .select({
        id: scans.id,
        repo: scans.repo,
        ref: scans.ref,
        commitSha: scans.commitSha,
        findingsCount: scans.findingsCount,
        highCount: scans.highCount,
        aiEnriched: scans.aiEnriched,
        createdAt: scans.createdAt,
      })
      .from(scans)
      .where(eq(scans.userId, session.user.id))
      .orderBy(desc(scans.createdAt))
      .limit(20),
  ]);

  return (
    <main>
      <header>
        <h1>Dashboard</h1>
        <p className="tagline">
          Signed in as <code>{session.user.email}</code>.{' '}
          <form action={signOutAction} style={{ display: 'inline' }}>
            <button
              type="submit"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--accent)',
                padding: 0,
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              Sign out
            </button>
          </form>
        </p>
      </header>

      <section className="uploader">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Subscription</h2>
        <div className="summary">
          <span className={`chip ${subscription.active ? 'low' : 'medium'}`}>
            {subscription.active ? 'active' : subscription.status ?? 'none'}
          </span>
          {subscription.currentPeriodEnd && (
            <span className="chip">
              renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
            </span>
          )}
        </div>
        <p className="hint">
          {subscription.active
            ? 'AI-enriched findings are active on every scan.'
            : 'Without an active subscription, the gate still runs; findings come back without AI analysis and the check posts a "subscription required for analysis" message instead of failing.'}
        </p>
        <BillingButtons subscribed={subscription.active} />
      </section>

      <ApiKeyManager initialKeys={keys} />

      <section className="uploader">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Recent scans</h2>
        {recentScans.length === 0 ? (
          <p className="hint">
            No scans yet. Add the Preflight Action to a workflow file and push.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {recentScans.map((s) => (
              <li key={s.id} className="finding" style={{ marginTop: 8 }}>
                <div className="top">
                  <h3>{s.repo ?? '(unknown repo)'}</h3>
                  <span className={`chip ${s.highCount > 0 ? 'high' : 'low'}`}>
                    {s.highCount} high · {s.findingsCount} total
                  </span>
                </div>
                <div className="meta">
                  <code>
                    {s.ref ?? 'unknown ref'}
                    {s.commitSha ? `@${s.commitSha.slice(0, 7)}` : ''}
                  </code>
                  · {s.aiEnriched ? 'AI-enriched' : 'deterministic only'}
                  · {new Date(s.createdAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="uploader">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Install the Action</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Add this to <code>.github/workflows/preflight.yml</code>:
        </p>
        <pre style={{ fontSize: 12 }}>
{`name: Preflight
on: [push, pull_request]
jobs:
  preflight:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      checks: write
    steps:
      - uses: actions/checkout@v4
      - uses: theartofthepossible2/preflight-action@v1
        with:
          api-key: \${{ secrets.PREFLIGHT_API_KEY }}`}
        </pre>
        <p className="hint">
          Then in Vercel → Project → Settings → Git → Deployment Checks, mark the{' '}
          <code>preflight</code> check as required.
        </p>
      </section>
    </main>
  );
}
