'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BriefcaseBusiness, Loader2, Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Offer } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ProductForm {
  name: string;
  category: string;
  provider: string;
  price_amount: string;
  fee_amount: string;
  benefits: string;
  min_budget: string;
  city: string;
  requirements: string;
  commission_value: string;
  metadata: string;
  is_active: boolean;
}

const EMPTY_FORM: ProductForm = {
  name: '',
  category: '',
  provider: '',
  price_amount: '0',
  fee_amount: '0',
  benefits: '',
  min_budget: '',
  city: '',
  requirements: '',
  commission_value: '0',
  metadata: '',
  is_active: true,
};

export default function ProductsPage() {
  const supabase = createClient();
  const [products, setProducts] = useState<Offer[]>([]);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('offers')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) toast.error(error.message);
    else setProducts((data ?? []) as Offer[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  function updateForm(patch: Partial<ProductForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  async function saveProduct() {
    if (!form.name.trim() || !form.category.trim()) {
      toast.error('Offer name and category are required.');
      return;
    }

    setSaving(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('You are not signed in.');

      const { error } = await supabase.from('offers').insert({
        user_id: user.id,
        name: form.name.trim(),
        category: form.category.trim(),
        provider: form.provider.trim(),
        price_amount: Number(form.price_amount) || 0,
        fee_amount: Number(form.fee_amount) || 0,
        benefits: csv(form.benefits),
        rules: {
          min_budget: Number(form.min_budget) || undefined,
          city: csv(form.city).map((value) => value.toLowerCase()),
        },
        requirements: csv(form.requirements),
        commission_value: Number(form.commission_value) || 0,
        metadata: parseMetadata(form.metadata),
        is_active: form.is_active,
      });

      if (error) throw error;
      toast.success('Offer saved');
      setForm(EMPTY_FORM);
      await fetchProducts();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save offer',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Catalog</h1>
        <p className="mt-1 text-sm text-slate-400">
          Manage products, services, packages, eligibility rules, and
          commissions.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="font-semibold text-white">Add Offer</h2>
          <div className="mt-4 grid gap-3">
            <Input
              value={form.name}
              onChange={(event) => updateForm({ name: event.target.value })}
              placeholder="Offer name"
              className="border-slate-700 bg-slate-950 text-white"
            />
            <Input
              value={form.category}
              onChange={(event) => updateForm({ category: event.target.value })}
              placeholder="Category, e.g. credit_card, clinic, course"
              className="border-slate-700 bg-slate-950 text-white"
            />
            <Input
              value={form.provider}
              onChange={(event) => updateForm({ provider: event.target.value })}
              placeholder="Provider or brand"
              className="border-slate-700 bg-slate-950 text-white"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={form.price_amount}
                onChange={(event) =>
                  updateForm({ price_amount: event.target.value })
                }
                placeholder="Price"
                className="border-slate-700 bg-slate-950 text-white"
              />
              <Input
                value={form.fee_amount}
                onChange={(event) =>
                  updateForm({ fee_amount: event.target.value })
                }
                placeholder="Fee"
                className="border-slate-700 bg-slate-950 text-white"
              />
            </div>
            <Input
              value={form.benefits}
              onChange={(event) => updateForm({ benefits: event.target.value })}
              placeholder="Benefits, comma-separated"
              className="border-slate-700 bg-slate-950 text-white"
            />
            <Input
              value={form.min_budget}
              onChange={(event) =>
                updateForm({ min_budget: event.target.value })
              }
              placeholder="Minimum budget"
              className="border-slate-700 bg-slate-950 text-white"
            />
            <Input
              value={form.city}
              onChange={(event) => updateForm({ city: event.target.value })}
              placeholder="Cities, comma-separated"
              className="border-slate-700 bg-slate-950 text-white"
            />
            <Input
              value={form.requirements}
              onChange={(event) =>
                updateForm({ requirements: event.target.value })
              }
              placeholder="Requirements, comma-separated"
              className="border-slate-700 bg-slate-950 text-white"
            />
            <Input
              value={form.commission_value}
              onChange={(event) =>
                updateForm({ commission_value: event.target.value })
              }
              placeholder="Commission value"
              className="border-slate-700 bg-slate-950 text-white"
            />
            <Input
              value={form.metadata}
              onChange={(event) => updateForm({ metadata: event.target.value })}
              placeholder='Optional JSON metadata, e.g. {"annual_fee":999}'
              className="border-slate-700 bg-slate-950 text-white"
            />
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) =>
                  updateForm({ is_active: event.target.checked })
                }
                className="size-4 rounded border-slate-700 bg-slate-950"
              />
              Active
            </label>
            <Button onClick={saveProduct} disabled={saving}>
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Save Offer
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/50">
          <div className="border-b border-slate-800 p-4">
            <h2 className="font-semibold text-white">Offers</h2>
          </div>
          {loading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-violet-500" />
            </div>
          ) : products.length === 0 ? (
            <div className="p-10 text-center">
              <BriefcaseBusiness className="mx-auto mb-3 size-10 text-slate-600" />
              <p className="text-sm text-slate-500">No offers yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {products.map((product) => (
                <div key={product.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-white">{product.name}</h3>
                      <p className="text-sm text-slate-400">
                        {[product.category, product.provider]
                          .filter(Boolean)
                          .join(' - ')}
                      </p>
                    </div>
                    <span
                      className={
                        product.is_active
                          ? 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400'
                          : 'rounded-full bg-slate-500/10 px-2 py-0.5 text-xs font-medium text-slate-400'
                      }
                    >
                      {product.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-3">
                    <p>Price: {money(product.price_amount)}</p>
                    <p>Fee: {money(product.fee_amount)}</p>
                    <p>Commission: {money(product.commission_value)}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {product.benefits.map((benefit) => (
                      <span
                        key={benefit}
                        className="rounded-full bg-violet-500/10 px-2 py-0.5 text-xs text-violet-300"
                      >
                        {benefit}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function csv(value: string): string[] {
  return value
    .split(',')
    .map((row) => row.trim())
    .filter(Boolean);
}

function parseMetadata(value: string): Record<string, unknown> {
  if (!value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function money(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}
