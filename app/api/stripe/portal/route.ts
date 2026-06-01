import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { stripe, getOrCreateStripeCustomer } from '@/lib/stripe';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const origin = new URL(req.url).origin;
  const customerId = await getOrCreateStripeCustomer(session.user.id, session.user.email);

  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/dashboard`,
  });

  return NextResponse.json({ url: portal.url });
}
