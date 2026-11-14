import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  requireRole,
  toErrorResponse,
  UnauthorizedError,
} from '@/lib/auth/account';
import { stripe } from '@/lib/stripe/client';

export async function POST(req: NextRequest) {
  try {
    if (!stripe) {
      return NextResponse.json(
        {
          error:
            'Stripe is not configured. Add STRIPE_SECRET_KEY to your environment.',
        },
        { status: 503 }
      );
    }

    const { supabase, accountId } = await requireRole('admin');

    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('account_id', accountId)
      .single();

    if (!subscription?.stripe_customer_id) {
      return NextResponse.json(
        { error: 'No active Stripe billing customer found for this account.' },
        { status: 404 }
      );
    }

    const origin =
      req.headers.get('origin') ||
      process.env.NEXT_PUBLIC_APP_URL ||
      'http://localhost:3000';

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${origin}/settings`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error);
    }
    console.error('Error creating Stripe customer portal session:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
