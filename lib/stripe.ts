import Stripe from 'stripe';
import { db } from '@/db';
import { subscriptions } from '@/db/schema';
import { eq } from 'drizzle-orm';

// Module-load must not throw — Vercel imports this during build before runtime
// env vars are inspected. If the key is missing, the SDK is still constructed
// with a placeholder and any real API call will fail with a Stripe auth error
// at request time, making the missing env var obvious in logs.
const apiKey = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';

export const stripe = new Stripe(apiKey, {
  apiVersion: '2025-02-24.acacia',
});

export const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID ?? '';

export type SubscriptionState = {
  active: boolean;
  status: string | null;
  currentPeriodEnd: Date | null;
};

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

export async function getSubscriptionState(userId: string): Promise<SubscriptionState> {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
  const row = rows[0];
  if (!row) return { active: false, status: null, currentPeriodEnd: null };
  return {
    active: ACTIVE_STATUSES.has(row.status),
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd,
  };
}

export async function getOrCreateStripeCustomer(userId: string, email: string): Promise<string> {
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
  if (rows[0]?.stripeCustomerId) return rows[0].stripeCustomerId;

  const customer = await stripe.customers.create({
    email,
    metadata: { userId },
  });

  // The unique index on userId arbitrates concurrent callers (e.g. a double-clicked
  // Subscribe, or checkout + portal racing): only one insert wins. A losing insert
  // returns no row, leaving our freshly created Stripe customer orphaned — delete it
  // and return the persisted one. Without this, two customers get minted and the one
  // we persist may differ from the one the webhook later keys on.
  const inserted = await db
    .insert(subscriptions)
    .values({
      userId,
      stripeCustomerId: customer.id,
      status: 'incomplete',
    })
    .onConflictDoNothing()
    .returning({ stripeCustomerId: subscriptions.stripeCustomerId });

  if (inserted[0]?.stripeCustomerId) return inserted[0].stripeCustomerId;

  await stripe.customers.del(customer.id).catch(() => {});
  const [row] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  if (!row?.stripeCustomerId) {
    // The row that caused the conflict vanished between insert and re-read — surface
    // it rather than returning the orphan we just deleted.
    throw new Error('Failed to resolve Stripe customer after insert conflict.');
  }
  return row.stripeCustomerId;
}
