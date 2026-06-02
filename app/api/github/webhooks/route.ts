import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { githubInstallations, repoSetups } from '@/db/schema';

// GitHub App install-lifecycle webhook. Lives under /api/* so it bypasses the auth
// middleware by design — GitHub POSTs here and authenticates via the HMAC signature,
// not a session cookie. Reacts to install/uninstall/suspend and repo add/remove so
// our githubInstallations / repoSetups rows don't go stale after the setup callback
// (app/api/github/setup) does the initial, OAuth-verified binding.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read at module scope like the Stripe webhook — a plain env read never throws, so
// build/prerender stays green with zero env (fail-soft contract).
const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET;

// Minimal shapes of the payloads we act on (full schema is large; mirror the
// self-contained-interface style of lib/github/oauth.ts rather than pull a types dep).
interface WebhookRepo {
  id: number;
  full_name: string;
}
interface WebhookPayload {
  action?: string;
  installation?: { id: number };
  repositories_removed?: WebhookRepo[];
}

// Constant-time check of GitHub's X-Hub-Signature-256 ("sha256=<hex>") against the
// raw body. Same primitive as lib/github/state.ts; length guard first so
// timingSafeEqual never throws on a mismatched-length attacker input.
function verifySignature(raw: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!webhookSecret) {
    // Can't verify without the secret, and this endpoint is unauthenticated — so we
    // must reject rather than trust an unsigned payload. One-click setup still works
    // without webhooks; this only disables lifecycle cleanup.
    return NextResponse.json({ error: 'Webhook secret not configured.' }, { status: 500 });
  }

  const raw = await req.text();
  const signature = req.headers.get('x-hub-signature-256');
  if (!verifySignature(raw, signature, webhookSecret)) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
  }

  const event = req.headers.get('x-github-event');
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(raw) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 });
  }

  const installationId = payload.installation?.id;

  try {
    switch (event) {
      case 'installation':
        if (Number.isInteger(installationId)) {
          await handleInstallation(payload.action, installationId!);
        }
        break;
      case 'installation_repositories':
        if (Number.isInteger(installationId) && payload.action === 'removed') {
          await removeRepoSetups(installationId!, payload.repositories_removed ?? []);
        }
        break;
      // ping (sent on webhook creation) and everything else: just acknowledge.
      default:
        break;
    }
  } catch {
    // Surface DB failures as 500 so GitHub retries the delivery (e.g. a transient
    // outage, or migration 0002 not yet applied — self-heals once it lands).
    return NextResponse.json({ error: 'Processing failed.' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleInstallation(action: string | undefined, installationId: number): Promise<void> {
  switch (action) {
    case 'deleted':
      // Uninstall: the App can no longer manage these repos, so drop our rows. The
      // per-repo API keys are intentionally left intact — the secret persists in the
      // repo and revoking would break a still-running CI; the user can revoke keys
      // themselves from the dashboard key manager. repoSetups.installationId has no DB
      // FK to githubInstallations, so it must be cleared explicitly (no cascade).
      await db.delete(repoSetups).where(eq(repoSetups.installationId, installationId));
      await db
        .delete(githubInstallations)
        .where(eq(githubInstallations.installationId, installationId));
      break;
    case 'suspend':
      await db
        .update(githubInstallations)
        .set({ suspendedAt: new Date(), updatedAt: new Date() })
        .where(eq(githubInstallations.installationId, installationId));
      break;
    case 'unsuspend':
      await db
        .update(githubInstallations)
        .set({ suspendedAt: null, updatedAt: new Date() })
        .where(eq(githubInstallations.installationId, installationId));
      break;
    // 'created' is owned by the OAuth-verified setup callback (we have no trusted
    // userId here); 'new_permissions_accepted' needs no state change.
    default:
      break;
  }
}

async function removeRepoSetups(installationId: number, repos: WebhookRepo[]): Promise<void> {
  const fullNames = repos.map((r) => r.full_name).filter((n): n is string => Boolean(n));
  if (fullNames.length === 0) return;
  await db
    .delete(repoSetups)
    .where(
      and(
        eq(repoSetups.installationId, installationId),
        inArray(repoSetups.repoFullName, fullNames),
      ),
    );
}
