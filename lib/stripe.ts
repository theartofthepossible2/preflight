import Stripe from 'stripe';
import { db } from '@/db';
import { subscriptions } from '@/db/schema';
import { eq } from 'drizzle-orm';

const apiKey = process.env.STRIPE_SECRET_KEY;
if (!apiKey && process.env.NODE_ENV === 'production') {
  throw new Error('STRIPE_SECRET_KEY is not configured.');
}

export const stripe = new Stripe(apiKey ?? 'sk_test_placeholder', {
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

  await db
    .insert(subscriptions)
    .values({
      userId,
      stripeCustomerId: customer.id,
      status: 'incomplete',
    })
    .onConflictDoNothing();

  return customer.id;
}
