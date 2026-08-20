'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCurrency } from '@/lib/currency';
import { createClient } from '@/lib/supabase/client';
import { loadCampaignAnalytics } from '@/lib/dashboard/rimula-analytics';
import type { CampaignAnalytics as CampaignAnalyticsData } from '@/lib/dashboard/types';
import { CampaignAnalytics } from '@/components/campaigns/campaign-analytics';

const STATUSES = [
  'draft',
  'active',
  'paused',
  'completed',
  'archived',
] as const;
const STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  draft: 'outline',
  active: 'default',
  paused: 'secondary',
  completed: 'secondary',
  archived: 'outline',
};

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface Product {
  id: string;
  product_name: string;
}
interface LinkedContent {
  id: string;
  title: string;
  status: string;
}
interface CampaignDetail {
  id: string;
  campaign_name: string;
  product_id: string | null;
  product: Product | Product[] | null;
  start_date: string | null;
  end_date: string | null;
  objective: string | null;
  content: string | null;
  cost: number | null;
  status: string;
  linked_content: LinkedContent[];
}

const NO_PRODUCT = '__none__';

/** Supabase renders an embedded to-one join as an object or a 1-array. */
function oneOf<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  // campaigns is agent+ writable (migration 043's RLS tier — a BA can
  // run a campaign, not just an admin), which is exactly what
  // canSendMessages means elsewhere in this codebase. The API/RLS are
  // the real enforcement either way (§14 — this only controls whether
  // the form fields render disabled, per the "shown but disabled, not
  // hidden" convention).
  const { canSendMessages, defaultCurrency } = useAuth();
  const canEdit = canSendMessages;

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);

  const [campaignName, setCampaignName] = useState('');
  const [productId, setProductId] = useState(NO_PRODUCT);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [objective, setObjective] = useState('');
  const [content, setContent] = useState('');
  const [cost, setCost] = useState('');
  const [saving, setSaving] = useState(false);

  const [analytics, setAnalytics] = useState<CampaignAnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${params.id}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to load campaign.');
        return;
      }
      const c: CampaignDetail = data.campaign;
      setCampaign(c);
      setCampaignName(c.campaign_name);
      setProductId(oneOf(c.product)?.id ?? c.product_id ?? NO_PRODUCT);
      setStartDate(c.start_date ?? '');
      setEndDate(c.end_date ?? '');
      setObjective(c.objective ?? '');
      setContent(c.content ?? '');
      setCost(c.cost != null ? String(c.cost) : '');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetch('/api/products')
      .then((res) => res.json())
      .then((data) => setProducts(data.products ?? []))
      .catch(() => {});
  }, []);

  // §13 analytics — a direct Supabase-client aggregation, same
  // pattern as `src/lib/dashboard/queries.ts` (the dashboard bypasses
  // the API layer for read-heavy aggregations; RLS still scopes it).
  useEffect(() => {
    setAnalyticsLoading(true);
    loadCampaignAnalytics(createClient(), params.id)
      .then((a) => setAnalytics(a))
      .catch((err) => console.error('[campaign analytics] failed:', err))
      .finally(() => setAnalyticsLoading(false));
  }, [params.id]);

  async function patchCampaign(
    body: Record<string, unknown>,
    successMessage: string
  ) {
    const res = await fetch(`/api/campaigns/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || 'Action failed.');
      return false;
    }
    toast.success(successMessage);
    await load();
    return true;
  }

  async function handleSave() {
    if (!campaignName.trim()) {
      toast.error('Campaign name is required.');
      return;
    }
    if (cost && (!Number.isFinite(Number(cost)) || Number(cost) < 0)) {
      toast.error('Cost must be a non-negative number.');
      return;
    }
    setSaving(true);
    try {
      await patchCampaign(
        {
          campaign_name: campaignName.trim(),
          product_id: productId === NO_PRODUCT ? null : productId,
          start_date: startDate || null,
          end_date: endDate || null,
          objective: objective.trim() || null,
          content: content.trim() || null,
          cost: cost ? Number(cost) : null,
        },
        'Saved.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(status: string) {
    setBusy(true);
    try {
      await patchCampaign({ status }, `Status set to ${capitalize(status)}.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!campaign) return;
    if (!confirm(`Delete "${campaign.campaign_name}"? This cannot be undone.`))
      return;
    const res = await fetch(`/api/campaigns/${campaign.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || 'Failed to delete.');
      return;
    }
    toast.success('Campaign deleted.');
    router.push('/campaigns');
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (!campaign) {
    return <p className="text-muted-foreground text-sm">Campaign not found.</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-foreground text-2xl font-bold">
              {campaign.campaign_name}
            </h1>
            <Badge variant={STATUS_VARIANT[campaign.status] ?? 'outline'}>
              {capitalize(campaign.status)}
            </Badge>
          </div>
          {campaign.cost != null && (
            <p className="text-muted-foreground mt-1 text-sm">
              {formatCurrency(campaign.cost, defaultCurrency)}
            </p>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Select
              value={campaign.status}
              onValueChange={(v) => v && void handleStatusChange(v)}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {capitalize(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void handleDelete()}
              disabled={busy}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        )}
      </div>

      <CampaignAnalytics
        analytics={analytics}
        loading={analyticsLoading}
        currency={defaultCurrency}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="campaign-name">Campaign name</Label>
            <Input
              id="campaign-name"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              disabled={!canEdit}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="campaign-product">Product</Label>
            <Select
              value={productId}
              onValueChange={(v) => v && setProductId(v)}
            >
              <SelectTrigger id="campaign-product" disabled={!canEdit}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PRODUCT}>No product</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.product_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="campaign-start">Start date</Label>
              <Input
                id="campaign-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campaign-end">End date</Label>
              <Input
                id="campaign-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={!canEdit}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="campaign-objective">Objective</Label>
            <Textarea
              id="campaign-objective"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              rows={3}
              disabled={!canEdit}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="campaign-content">Notes</Label>
            <Textarea
              id="campaign-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
              disabled={!canEdit}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="campaign-cost">Cost</Label>
            <Input
              id="campaign-cost"
              type="number"
              min="0"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="Leave blank if no cost data exists (§13)"
              disabled={!canEdit}
            />
          </div>

          {canEdit && (
            <div className="flex justify-end">
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Save
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Attributed content</CardTitle>
          <CardDescription>
            Content Studio posts assigned to this campaign — assign them from
            the content item itself.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {campaign.linked_content.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No content attributed yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {campaign.linked_content.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/content/${c.id}`}
                    className="text-foreground text-sm hover:underline"
                  >
                    {c.title}
                  </Link>
                  <span className="text-muted-foreground ml-2 text-xs">
                    {c.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Link
        href="/campaigns"
        className={buttonVariants({ variant: 'outline' })}
      >
        Back to Campaigns
      </Link>
    </div>
  );
}
