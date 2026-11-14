'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  CreditCard,
  Copy,
  Loader2,
  AlertCircle,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface GatewayStatus {
  provider: 'razorpay' | 'stripe';
  isActive: boolean;
  publishableKey: string | null;
  hasSecretKey: boolean;
  hasWebhookSecret: boolean;
  maskedPublishableKey: string | null;
}

export function PaymentsConfig() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gateways, setGateways] = useState<{
    razorpay: GatewayStatus;
    stripe: GatewayStatus;
  } | null>(null);

  // Form states
  const [activeTab, setActiveTab] = useState<'razorpay' | 'stripe'>('razorpay');

  // Razorpay
  const [rzpActive, setRzpActive] = useState(false);
  const [rzpKeyId, setRzpKeyId] = useState('');
  const [rzpKeySecret, setRzpKeySecret] = useState('');
  const [rzpWebhookSecret, setRzpWebhookSecret] = useState('');

  // Stripe
  const [stripeActive, setStripeActive] = useState(false);
  const [stripePublishableKey, setStripePublishableKey] = useState('');
  const [stripeSecretKey, setStripeSecretKey] = useState('');
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState('');

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/payments/config');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load gateway config');

      setGateways(data);
      if (data.razorpay) {
        setRzpActive(data.razorpay.isActive);
        setRzpKeyId(data.razorpay.publishableKey || '');
      }
      if (data.stripe) {
        setStripeActive(data.stripe.isActive);
        setStripePublishableKey(data.stripe.publishableKey || '');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error fetching payments config');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchConfig();
  }, []);

  const handleSaveRazorpay = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, string | boolean> = {
        provider: 'razorpay',
        isActive: rzpActive,
        publishableKey: rzpKeyId,
      };
      if (rzpKeySecret) payload.secretKey = rzpKeySecret;
      if (rzpWebhookSecret) payload.webhookSecret = rzpWebhookSecret;

      const res = await fetch('/api/payments/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save Razorpay config');

      toast.success('Razorpay configuration updated');
      setRzpKeySecret('');
      setRzpWebhookSecret('');
      void fetchConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveStripe = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, string | boolean> = {
        provider: 'stripe',
        isActive: stripeActive,
        publishableKey: stripePublishableKey,
      };
      if (stripeSecretKey) payload.secretKey = stripeSecretKey;
      if (stripeWebhookSecret) payload.webhookSecret = stripeWebhookSecret;

      const res = await fetch('/api/payments/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save Stripe config');

      toast.success('Stripe configuration updated');
      setStripeSecretKey('');
      setStripeWebhookSecret('');
      void fetchConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save error');
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://wacrm-peach-iota.vercel.app';
  const razorpayWebhookUrl = `${origin}/api/payments/webhook/razorpay`;
  const stripeWebhookUrl = `${origin}/api/payments/webhook/stripe`;

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading payment settings...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          Payment Gateways & In-Chat Checkout
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect Razorpay (UPI, Cards, NetBanking) or Stripe to accept instant payments from leads and customers directly in WhatsApp chats.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'razorpay' | 'stripe')}>
        <TabsList className="grid w-full grid-cols-2 max-w-sm">
          <TabsTrigger value="razorpay" className="flex items-center gap-2">
            <span>Razorpay (India / UPI)</span>
            {gateways?.razorpay.isActive && gateways.razorpay.hasSecretKey && (
              <Badge variant="outline" className="h-5 text-[10px] bg-green-500/10 text-green-600 border-green-500/30">
                Active
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="stripe" className="flex items-center gap-2">
            <span>Stripe (Global)</span>
            {gateways?.stripe.isActive && gateways.stripe.hasSecretKey && (
              <Badge variant="outline" className="h-5 text-[10px] bg-green-500/10 text-green-600 border-green-500/30">
                Active
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Razorpay Tab */}
        <TabsContent value="razorpay" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">Razorpay Integration</CardTitle>
                  <CardDescription className="text-xs">
                    Generate instant WhatsApp payment links supporting UPI (GPay, PhonePe, Paytm), Credit/Debit Cards, and NetBanking.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="rzp-active" className="text-sm font-medium">
                    {rzpActive ? 'Enabled' : 'Disabled'}
                  </Label>
                  <Switch
                    id="rzp-active"
                    checked={rzpActive}
                    onCheckedChange={setRzpActive}
                  />
                </div>
              </div>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSaveRazorpay} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="rzp-key-id">Key ID (Publishable)</Label>
                  <Input
                    id="rzp-key-id"
                    value={rzpKeyId}
                    onChange={(e) => setRzpKeyId(e.target.value)}
                    placeholder="rzp_live_xxxxxxxxxxxx or rzp_test_xxxxxxxxxxxx"
                    required={rzpActive}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="rzp-key-secret">Key Secret</Label>
                    {gateways?.razorpay.hasSecretKey && (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <Lock className="h-3 w-3" /> Secret securely stored (AES-256-GCM)
                      </span>
                    )}
                  </div>
                  <Input
                    id="rzp-key-secret"
                    type="password"
                    value={rzpKeySecret}
                    onChange={(e) => setRzpKeySecret(e.target.value)}
                    placeholder={gateways?.razorpay.hasSecretKey ? '•••••••••••••••• (Leave blank to keep existing)' : 'Enter Razorpay Key Secret'}
                    required={rzpActive && !gateways?.razorpay.hasSecretKey}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="rzp-wh-secret">Webhook Secret (Optional for Signature Verification)</Label>
                    {gateways?.razorpay.hasWebhookSecret && (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <Lock className="h-3 w-3" /> Webhook secret stored
                      </span>
                    )}
                  </div>
                  <Input
                    id="rzp-wh-secret"
                    type="password"
                    value={rzpWebhookSecret}
                    onChange={(e) => setRzpWebhookSecret(e.target.value)}
                    placeholder={gateways?.razorpay.hasWebhookSecret ? '•••••••• (Leave blank to keep existing)' : 'Enter Webhook Secret configured in Razorpay Dashboard'}
                  />
                </div>

                <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2 text-xs">
                  <div className="font-medium text-foreground flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4 text-primary" />
                    Razorpay Webhook Configuration
                  </div>
                  <p className="text-muted-foreground">
                    Add this Webhook URL in your Razorpay Dashboard (Settings → Webhooks) with event <code className="text-primary font-mono font-semibold">payment_link.paid</code>:
                  </p>
                  <div className="flex items-center justify-between rounded bg-background p-2 font-mono text-[11px] border border-border">
                    <span className="truncate mr-2">{razorpayWebhookUrl}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => copyToClipboard(razorpayWebhookUrl, 'Razorpay Webhook URL')}
                    >
                      <Copy className="h-3 w-3 mr-1" /> Copy
                    </Button>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button type="submit" disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Razorpay Settings
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Stripe Tab */}
        <TabsContent value="stripe" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">Stripe Checkout Integration</CardTitle>
                  <CardDescription className="text-xs">
                    Accept global payments in USD, EUR, GBP, and 135+ currencies with instant card checkout links sent via WhatsApp.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="stripe-active" className="text-sm font-medium">
                    {stripeActive ? 'Enabled' : 'Disabled'}
                  </Label>
                  <Switch
                    id="stripe-active"
                    checked={stripeActive}
                    onCheckedChange={setStripeActive}
                  />
                </div>
              </div>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSaveStripe} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="stripe-pk">Publishable Key (Optional)</Label>
                  <Input
                    id="stripe-pk"
                    value={stripePublishableKey}
                    onChange={(e) => setStripePublishableKey(e.target.value)}
                    placeholder="pk_live_xxxxxxxxxxxx or pk_test_xxxxxxxxxxxx"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="stripe-sk">Restricted or Secret Key (Required)</Label>
                    {gateways?.stripe.hasSecretKey && (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <Lock className="h-3 w-3" /> Secret securely stored (AES-256-GCM)
                      </span>
                    )}
                  </div>
                  <Input
                    id="stripe-sk"
                    type="password"
                    value={stripeSecretKey}
                    onChange={(e) => setStripeSecretKey(e.target.value)}
                    placeholder={gateways?.stripe.hasSecretKey ? '•••••••••••••••• (Leave blank to keep existing)' : 'sk_live_... or sk_test_...'}
                    required={stripeActive && !gateways?.stripe.hasSecretKey}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="stripe-wh">Webhook Signing Secret (whsec_...)</Label>
                    {gateways?.stripe.hasWebhookSecret && (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <Lock className="h-3 w-3" /> Webhook secret stored
                      </span>
                    )}
                  </div>
                  <Input
                    id="stripe-wh"
                    type="password"
                    value={stripeWebhookSecret}
                    onChange={(e) => setStripeWebhookSecret(e.target.value)}
                    placeholder={gateways?.stripe.hasWebhookSecret ? '•••••••• (Leave blank to keep existing)' : 'whsec_xxxxxxxxxxxx'}
                  />
                </div>

                <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2 text-xs">
                  <div className="font-medium text-foreground flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4 text-primary" />
                    Stripe Webhook Configuration
                  </div>
                  <p className="text-muted-foreground">
                    Add this Endpoint in Stripe Dashboard (Developers → Webhooks) listening for <code className="text-primary font-mono font-semibold">checkout.session.completed</code>:
                  </p>
                  <div className="flex items-center justify-between rounded bg-background p-2 font-mono text-[11px] border border-border">
                    <span className="truncate mr-2">{stripeWebhookUrl}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => copyToClipboard(stripeWebhookUrl, 'Stripe Webhook URL')}
                    >
                      <Copy className="h-3 w-3 mr-1" /> Copy
                    </Button>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button type="submit" disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Stripe Settings
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
