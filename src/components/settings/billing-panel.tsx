'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, ArrowUpRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SettingsPanelHead } from './settings-panel-head';
import { SAAS_PLANS, type PlanTier } from '@/lib/billing/plans';

interface SubscriptionData {
  plan_tier: PlanTier;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  stripe_customer_id: string | null;
}

export function BillingPanel() {
  const { accountId, accountRole } = useAuth();
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionData | null>(
    null
  );
  const [currency, setCurrency] = useState<'INR' | 'USD'>('INR');

  const canManage = accountRole === 'owner' || accountRole === 'admin';

  useEffect(() => {
    async function loadSubscription() {
      if (!accountId) return;
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('subscriptions')
          .select(
            'plan_tier, status, current_period_end, cancel_at_period_end, stripe_customer_id'
          )
          .eq('account_id', accountId)
          .maybeSingle();

        if (error && error.code !== 'PGRST116') {
          console.error('Failed to load subscription:', error);
        } else if (data) {
          setSubscription(data as SubscriptionData);
        }
      } catch (err) {
        console.error('Failed to load subscription:', err);
      }
    }

    loadSubscription();
  }, [accountId]);

  const handleCheckout = async (planTier: PlanTier) => {
    try {
      setSubmitting(planTier);
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planTier }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start checkout');
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setSubmitting(null);
    }
  };

  const handlePortal = async () => {
    try {
      setSubmitting('portal');
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || 'Failed to open billing portal');
      if (data.url) window.location.href = data.url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open portal');
    } finally {
      setSubmitting(null);
    }
  };

  const currentPlan = subscription?.plan_tier || 'starter';
  const isActive = subscription?.status === 'active';
  const isTrial = subscription?.status === 'trialing';

  return (
    <div className="space-y-6">
      <SettingsPanelHead
        title="Subscription & Billing"
        description="Manage your SaaS workspace plan, agent limits, and payment methods."
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-lg">Current Workspace Plan</CardTitle>
            <CardDescription className="mt-1">
              {isTrial && 'You are currently on a 14-day free trial.'}
              {isActive &&
                'Your subscription is active and renews automatically.'}
              {!isTrial && !isActive && 'No active paid subscription.'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={isActive ? 'default' : isTrial ? 'secondary' : 'outline'}
            >
              {subscription?.status
                ? subscription.status.toUpperCase()
                : 'FREE'}
            </Badge>
            {subscription?.stripe_customer_id && canManage && (
              <Button
                variant="outline"
                size="sm"
                onClick={handlePortal}
                disabled={submitting === 'portal'}
              >
                {submitting === 'portal' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Manage Cards & Invoices
                    <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                  </>
                )}
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground">Available Subscription Plans</h3>
        <div className="flex items-center rounded-lg border border-border p-0.5 bg-muted/40 text-xs font-medium">
          <button
            type="button"
            onClick={() => setCurrency('INR')}
            className={`px-3 py-1 rounded-md transition-colors ${
              currency === 'INR'
                ? 'bg-background text-foreground shadow-sm font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            INR (₹)
          </button>
          <button
            type="button"
            onClick={() => setCurrency('USD')}
            className={`px-3 py-1 rounded-md transition-colors ${
              currency === 'USD'
                ? 'bg-background text-foreground shadow-sm font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            USD ($)
          </button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {(Object.keys(SAAS_PLANS) as PlanTier[]).map((tierKey) => {
          const plan = SAAS_PLANS[tierKey];
          const isSelected = currentPlan === tierKey;

          return (
            <Card
              key={tierKey}
              className={`flex flex-col justify-between ${
                tierKey === 'growth' ? 'border-primary shadow-sm' : ''
              }`}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{plan.name}</CardTitle>
                  {tierKey === 'growth' && (
                    <Badge variant="default" className="text-xs">
                      Popular
                    </Badge>
                  )}
                </div>
                <CardDescription className="mt-1 min-h-10">
                  {plan.description}
                </CardDescription>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-bold tracking-tight">
                    {currency === 'INR'
                      ? `₹${plan.priceInrMonthly.toLocaleString('en-IN')}`
                      : `$${plan.priceMonthly}`}
                  </span>
                  <span className="text-muted-foreground text-sm">/month</span>
                </div>
              </CardHeader>

              <CardContent className="space-y-2.5 text-sm">
                <div className="flex items-center gap-2">
                  <Check className="text-primary h-4 w-4 shrink-0" />
                  <span>Up to {plan.limits.maxSeats} team members</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="text-primary h-4 w-4 shrink-0" />
                  <span>{plan.limits.maxWhatsAppNumbers} WhatsApp Number</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="text-primary h-4 w-4 shrink-0" />
                  <span>
                    {plan.limits.maxMonthlyBroadcasts.toLocaleString()}{' '}
                    broadcasts/mo
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="text-primary h-4 w-4 shrink-0" />
                  <span>
                    {plan.limits.hasAutomations
                      ? 'Full visual automations'
                      : 'Basic triggers only'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="text-primary h-4 w-4 shrink-0" />
                  <span>
                    {plan.limits.hasAiReplies
                      ? 'AI auto-replies included'
                      : 'No AI replies'}
                  </span>
                </div>
              </CardContent>

              <CardFooter className="pt-4">
                <Button
                  className="w-full"
                  variant={isSelected && isActive ? 'outline' : 'default'}
                  disabled={
                    !canManage ||
                    (isSelected && isActive) ||
                    submitting === tierKey
                  }
                  onClick={() => handleCheckout(tierKey)}
                >
                  {submitting === tierKey ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isSelected && isActive ? (
                    'Current Plan'
                  ) : (
                    'Upgrade to ' + plan.name
                  )}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
