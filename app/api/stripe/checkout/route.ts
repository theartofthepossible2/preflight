import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { stripe, STRIPE_PRICE_ID, getOrCreateStripeCustomer } from '@/lib/stripe';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!STRIPE_PRICE_ID) {
    return NextResponse.json({ error: 'Stripe price not configured.' }, { status: 500 });
  }

  const origin = new URL(req.url).origin;
  const customerId = await getOrCreateStripeCustomer(session.user.id, session.user.email);

  const checkout = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${origin}/dashboard?checkout=success`,
    cancel_url: `${origin}/dashboard?checkout=cancelled`,
    allow_promotion_codes: true,
    client_reference_id: session.user.id,
  });

  return NextResponse.json({ url: checkout.url });
}
