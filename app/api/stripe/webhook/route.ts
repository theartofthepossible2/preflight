import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { db } from '@/db';
import { subscriptions } from '@/db/schema';
import { stripe } from '@/lib/stripe';

export const runtime = 'nodejs';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(req: Request) {
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Webhook secret not configured.' }, { status: 500 });
  }
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header.' }, { status: 400 });
  }

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid signature';
    return NextResponse.json({ error: `Webhook signature verification failed: ${message}` }, { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
      const subscriptionId =
        typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
      if (!customerId) break;
      await upsertSubscriptionByCustomer(customerId, {
        stripeSubscriptionId: subscriptionId ?? null,
        status: 'active',
      });
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      await upsertSubscriptionByCustomer(customerId, {
        stripeSubscriptionId: sub.id,
        status: sub.status,
        stripePriceId: sub.items.data[0]?.price.id ?? null,
        currentPeriodEnd: new Date(sub.current_period_end * 1000),
      });
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}

interface SubscriptionPatch {
  stripeSubscriptionId?: string | null;
  status?: string;
  stripePriceId?: string | null;
  currentPeriodEnd?: Date;
}

async function upsertSubscriptionByCustomer(stripeCustomerId: string, patch: SubscriptionPatch) {
  const existing = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, stripeCustomerId))
    .limit(1);

  if (!existing[0]) {
    // We only create on checkout.session.completed where we have user context via metadata.
    // Subscription updates for unknown customers are ignored.
    return;
  }

  await db
    .update(subscriptions)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.stripeCustomerId, stripeCustomerId));
}
