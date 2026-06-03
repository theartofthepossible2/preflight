import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/db';
import { scans } from '@/db/schema';
import { listKeys } from '@/lib/apiKey';
import { getSubscriptionState } from '@/lib/stripe';
import { WORKFLOW_YAML } from '@/lib/github/workflow-template';
import { loadConnectState } from '@/lib/github/setup-data';
import { DEFAULT_GATE_PROVIDER, getGateProvider, listGateProviders } from '@/lib/gates';
import { signOutAction } from './actions';
import { ConnectManager } from './connect-client';
import { ApiKeyManager, BillingButtons, DeleteAccount } from './dashboard-client';

export const dynamic = 'force-dynamic';

// Statuses where a Stripe customer/subscription exists but billing is unhealthy.
// These route the user to the portal (fix card) and surface a dunning notice,
// rather than offering a fresh checkout.
const DUNNING_STATUSES = new Set(['past_due', 'unpaid', 'incomplete']);

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/dashboard');

  const [subscription, keys, recentScans, connectState] = await Promise.all([
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
    loadConnectState(session.user.id),
  ]);

  const hasBillingIssue = DUNNING_STATUSES.has(subscription.status ?? '');

  // Flatten a gate provider into a serializable descriptor so the client never
  // imports the server-only gate registry. Each descriptor carries the real repo
  // context, so an adapter whose instructions/settings are repo- or site-specific
  // (Netlify, Cloudflare) renders correctly per row instead of from a placeholder.
  const gateDescriptor = (providerId: string, repoFullName: string, defaultBranch?: string) => {
    const provider = getGateProvider(providerId);
    const ctx = { repoFullName, defaultBranch };
    return {
      id: provider.id,
      label: provider.label,
      settingsUrl: provider.settingsUrl(ctx),
      instructions: provider.instructions(ctx).map((i) => i.text),
    };
  };

  // Default descriptor for the active provider (used for not-yet-configured repos and
  // optimistic UI); plus a per-repo map keyed by full name with each repo's provider.
  const gate = gateDescriptor(DEFAULT_GATE_PROVIDER, '');
  const gates = Object.fromEntries(
    connectState.setups.map((s) => [
      s.repoFullName,
      gateDescriptor(s.gateProvider, s.repoFullName, s.defaultBranch ?? undefined),
    ]),
  );
  const providers = listGateProviders();

  return (
    <>
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
        {hasBillingIssue && (
          <div
            className="notice warn"
            style={{ margin: '12px 0', padding: 12, border: '1px solid var(--medium)', borderRadius: 8 }}
          >
            <strong>There&apos;s a problem with your subscription.</strong> Your most
            recent payment didn&apos;t go through, so enrichment is paused. Update your
            payment method to restore it.
          </div>
        )}
        <p className="hint">
          {subscription.active
            ? 'Enriched findings are active on every scan.'
            : 'Without an active subscription, the gate still runs; findings come back without enrichment and the check posts a "subscription required for analysis" message instead of failing.'}
        </p>
        <BillingButtons subscribed={subscription.active} hasBillingIssue={hasBillingIssue} />
      </section>

      <ConnectManager
        configured={connectState.configured}
        subscribed={subscription.active}
        installations={connectState.installations}
        repos={connectState.repos}
        setups={connectState.setups}
        gate={gate}
        gates={gates}
        providers={providers}
      />

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
                  · {s.aiEnriched ? 'enriched' : 'findings only'}
                  · {new Date(s.createdAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="uploader">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Manual setup</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Prefer to wire it up yourself? Add this to{' '}
          <code>.github/workflows/preflight.yml</code>:
        </p>
        <pre style={{ fontSize: 12 }}>{WORKFLOW_YAML.trimEnd()}</pre>
        <p className="hint">
          Then in Vercel → Project → Settings → Deployment Checks, select the auto-discovered{' '}
          <code>preflight</code> check and require it for Production.
        </p>
      </section>

      <DeleteAccount />
    </main>
    <footer style={{ borderTop: '1px solid var(--border)', marginTop: 48 }}>
      <div
        style={{
          maxWidth: 880,
          margin: '0 auto',
          padding: 20,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 12,
          color: 'var(--muted)',
        }}
      >
        <span>&copy; {new Date().getFullYear()} Space. All rights reserved.</span>
        <nav style={{ display: 'flex', gap: 16 }}>
          <Link href="/terms" style={{ color: 'var(--accent)' }}>
            Terms of Service
          </Link>
          <Link href="/privacy" style={{ color: 'var(--accent)' }}>
            Privacy Policy
          </Link>
        </nav>
      </div>
    </footer>
    </>
  );
}
