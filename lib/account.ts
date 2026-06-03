import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { githubInstallations, subscriptions, users } from '@/db/schema';
import { deleteInstallation } from '@/lib/github/app';
import { stripe } from '@/lib/stripe';

// Full account teardown. Each external step is best-effort: a Stripe or GitHub
// outage must never leave a user unable to delete their account, so we always reach
// the local delete. The local delete is the authoritative end state — everything
// user-scoped goes with it via ON DELETE CASCADE.
export async function deleteAccount(userId: string): Promise<void> {
  const [sub] = await db
    .select({
      stripeCustomerId: subscriptions.stripeCustomerId,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  // Billing: stop the recurring charge, then delete the customer (removes the PII
  // Stripe holds — email, card metadata). Deleting the customer also detaches the
  // subscription, but cancel first so a failed customer delete still halts billing.
  if (sub?.stripeSubscriptionId) {
    try {
      await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
    } catch {
      // Already canceled or gone — nothing to stop.
    }
  }
  if (sub?.stripeCustomerId) {
    try {
      await stripe.customers.del(sub.stripeCustomerId);
    } catch {
      // Already deleted — ignore.
    }
  }

  // GitHub: uninstall the App from every account the user connected so we stop
  // holding write access to their repos. This is the authoritative revoke; the local
  // install/setup rows are removed by the cascade below (and the lifecycle webhook).
  const installs = await db
    .select({ installationId: githubInstallations.installationId })
    .from(githubInstallations)
    .where(eq(githubInstallations.userId, userId));
  for (const i of installs) {
    try {
      await deleteInstallation(i.installationId);
    } catch {
      // Best effort per installation — a failure here still lets the account delete.
    }
  }

  // Local: deleting the user cascades to accounts, sessions, subscriptions, api_key
  // (revoking every key), scans, github_installation and repo_setup. Shared tables
  // (analysis_cache, rate_limit, stripe_event) are not user-scoped and are left as-is.
  await db.delete(users).where(eq(users.id, userId));
}
