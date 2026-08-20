'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Product {
  id: string;
  product_name: string;
}

const NO_PRODUCT = '__none__';

export default function NewCampaignPage() {
  const router = useRouter();
  const [campaignName, setCampaignName] = useState('');
  const [productId, setProductId] = useState(NO_PRODUCT);
  const [products, setProducts] = useState<Product[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [objective, setObjective] = useState('');
  const [cost, setCost] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/products')
      .then((res) => res.json())
      .then((data) => setProducts(data.products ?? []))
      .catch(() => {});
  }, []);

  async function handleCreate() {
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
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_name: campaignName.trim(),
          product_id: productId === NO_PRODUCT ? null : productId,
          start_date: startDate || null,
          end_date: endDate || null,
          objective: objective.trim() || null,
          cost: cost ? Number(cost) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to create campaign.');
        return;
      }
      toast.success('Campaign created.');
      router.push(`/campaigns/${data.campaign.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-foreground text-2xl font-bold">New campaign</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Group content and broadcasts around a product for the funnel
          attribution in §13.
        </p>
      </div>

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
              placeholder="e.g. Winter Oil Change Push"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="campaign-product">Product (optional)</Label>
            <Select
              value={productId}
              onValueChange={(v) => v && setProductId(v)}
            >
              <SelectTrigger id="campaign-product">
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
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campaign-end">End date</Label>
              <Input
                id="campaign-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
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
              placeholder="What is this campaign trying to achieve?"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="campaign-cost">Cost (optional)</Label>
            <Input
              id="campaign-cost"
              type="number"
              min="0"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="Leave blank if no cost data exists (§13)"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => router.push('/campaigns')}>
          Cancel
        </Button>
        <Button onClick={handleCreate} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Create draft
        </Button>
      </div>
    </div>
  );
}
