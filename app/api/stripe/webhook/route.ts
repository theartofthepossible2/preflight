import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { db } from '@/db';
import { stripeEvents, subscriptions } from '@/db/schema';
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
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 },
    );
  }

  // Idempotency ledger: atomically claim this event id. An empty result means the
  // row already exists, i.e. we've handled this event before (Stripe delivers at
  // least once), so the replay is a no-op.
  const claim = await db
    .insert(stripeEvents)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing()
    .returning({ id: stripeEvents.id });
  if (claim.length === 0) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    // Release the claim so Stripe's redelivery re-runs the handler. Without this a
    // transient failure (e.g. a Stripe API blip while re-reading the subscription)
    // would record the event as done and the customer's status would never sync.
    try {
      await db.delete(stripeEvents).where(eq(stripeEvents.id, event.id));
    } catch {
      // If the release also fails, Stripe still retries; worst case is a skipped
      // event, surfaced by the error log below.
    }
    const message = err instanceof Error ? err.message : 'handler error';
    console.error(`stripe webhook: handling ${event.type} (${event.id}) failed — ${message}`);
    return NextResponse.json({ error: 'Webhook handler failed.' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerId =
        typeof session.customer === 'string' ? session.customer : session.customer?.id;
      const subscriptionId =
        typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
      if (!customerId || !subscriptionId) break;
      // Read the real subscription instead of assuming 'active': checkout can complete
      // while payment is still processing ('incomplete') or inside a trial period, and
      // this event can arrive after a customer.subscription.* event. Hardcoding 'active'
      // would clobber the true status; upserting the fetched status is order-independent.
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      await upsertSubscriptionByCustomer(customerId, patchFromSubscription(sub));
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.trial_will_end': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      await upsertSubscriptionByCustomer(customerId, patchFromSubscription(sub));
      break;
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      const subscriptionId =
        typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
      if (!customerId || !subscriptionId) break;
      // Re-read the subscription so status follows Stripe's dunning state machine:
      // past_due / unpaid when a charge fails, back to active once a retry succeeds.
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      await upsertSubscriptionByCustomer(customerId, patchFromSubscription(sub));
      break;
    }
    default:
      break;
  }
}

interface SubscriptionPatch {
  stripeSubscriptionId?: string | null;
  status?: string;
  stripePriceId?: string | null;
  currentPeriodEnd?: Date;
}

function patchFromSubscription(sub: Stripe.Subscription): SubscriptionPatch {
  return {
    stripeSubscriptionId: sub.id,
    status: sub.status,
    stripePriceId: sub.items.data[0]?.price.id ?? null,
    currentPeriodEnd: new Date(sub.current_period_end * 1000),
  };
}

async function upsertSubscriptionByCustomer(stripeCustomerId: string, patch: SubscriptionPatch) {
  const existing = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, stripeCustomerId))
    .limit(1);

  if (!existing[0]) {
    // The customer row is created up front by getOrCreateStripeCustomer (which holds
    // the userId). An event for an unknown customer has no user to attach to, so we
    // ignore it rather than insert a userless subscription.
    return;
  }

  await db
    .update(subscriptions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(subscriptions.stripeCustomerId, stripeCustomerId));
}
