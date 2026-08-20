'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Loader2, Trash2, Upload, X, Plus, Check, Ban } from 'lucide-react';
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
import { TagListEditor } from '@/components/products/tag-list-editor';
import { ProductAnalytics } from '@/components/products/product-analytics';
import { createClient } from '@/lib/supabase/client';
import { loadProductAnalytics } from '@/lib/dashboard/rimula-analytics';
import type { ProductAnalytics as ProductAnalyticsData } from '@/lib/dashboard/types';
import {
  uploadAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
  getAccountMediaPublicUrl,
} from '@/lib/storage/upload-media';

const CHAT_MEDIA_BUCKET = 'chat-media';
const NO_CATEGORY = '__none__';

const STATUSES = ['draft', 'pending_review', 'published', 'archived'] as const;
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'Pending review',
  published: 'Published',
  archived: 'Archived',
};

const CLAIM_STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  draft: 'outline',
  pending_review: 'secondary',
  approved: 'default',
  rejected: 'destructive',
};

interface Category {
  id: string;
  name: string;
}
interface ProductImage {
  id: string;
  storage_path: string;
  alt_text: string | null;
  position: number;
}
interface ProductApplication {
  id: string;
  application: string;
  notes: string | null;
}
interface ProductClaim {
  id: string;
  claim_text: string;
  status: string;
  created_at: string;
}
interface Vehicle {
  id: string;
  vehicle_type: string;
  manufacturer: string;
  model: string;
  engine: string;
}
interface CompatibleVehicle {
  id: string;
  notes: string | null;
  verified_at: string;
  vehicle: Vehicle | Vehicle[] | null;
}
interface ProductDetail {
  id: string;
  product_name: string;
  product_code: string | null;
  category_id: string | null;
  category: Category | null;
  description: string | null;
  short_description: string | null;
  long_description: string | null;
  key_features: string[];
  benefits: string[];
  vehicle_types: string[];
  recommended_vehicles: string[];
  engine_types: string[];
  packaging: string | null;
  status: string;
  images: ProductImage[];
  applications: ProductApplication[];
  claims: ProductClaim[];
  compatible_vehicles: CompatibleVehicle[];
}

/** Supabase renders an embedded to-one join as an object or a 1-array. */
function oneOf<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { canEditSettings } = useAuth();
  const isAdmin = canEditSettings;

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);

  // Basics form state
  const [productName, setProductName] = useState('');
  const [productCode, setProductCode] = useState('');
  const [categoryId, setCategoryId] = useState(NO_CATEGORY);
  const [shortDescription, setShortDescription] = useState('');
  const [description, setDescription] = useState('');
  const [longDescription, setLongDescription] = useState('');
  const [packaging, setPackaging] = useState('');
  const [keyFeatures, setKeyFeatures] = useState<string[]>([]);
  const [benefits, setBenefits] = useState<string[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<string[]>([]);
  const [recommendedVehicles, setRecommendedVehicles] = useState<string[]>([]);
  const [engineTypes, setEngineTypes] = useState<string[]>([]);
  const [savingBasics, setSavingBasics] = useState(false);

  const [analytics, setAnalytics] = useState<ProductAnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  // Sub-resource forms
  const [uploading, setUploading] = useState(false);
  const [applicationDraft, setApplicationDraft] = useState('');
  const [applicationNotesDraft, setApplicationNotesDraft] = useState('');
  const [claimDraft, setClaimDraft] = useState('');
  const [allVehicles, setAllVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [compatNotesDraft, setCompatNotesDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/products/${params.id}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to load product.');
        return;
      }
      const p: ProductDetail = data.product;
      setProduct(p);
      setProductName(p.product_name);
      setProductCode(p.product_code ?? '');
      setCategoryId(p.category_id ?? NO_CATEGORY);
      setShortDescription(p.short_description ?? '');
      setDescription(p.description ?? '');
      setLongDescription(p.long_description ?? '');
      setPackaging(p.packaging ?? '');
      setKeyFeatures(p.key_features ?? []);
      setBenefits(p.benefits ?? []);
      setVehicleTypes(p.vehicle_types ?? []);
      setRecommendedVehicles(p.recommended_vehicles ?? []);
      setEngineTypes(p.engine_types ?? []);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // §11/§13 analytics — direct Supabase-client aggregation, same
  // pattern as the dashboard and campaign detail page.
  useEffect(() => {
    setAnalyticsLoading(true);
    loadProductAnalytics(createClient(), params.id)
      .then((a) => setAnalytics(a))
      .catch((err) => console.error('[product analytics] failed:', err))
      .finally(() => setAnalyticsLoading(false));
  }, [params.id]);

  useEffect(() => {
    fetch('/api/product-categories')
      .then((res) => res.json())
      .then((data) => setCategories(data.categories ?? []))
      .catch(() => {});
    fetch('/api/vehicles')
      .then((res) => res.json())
      .then((data) => setAllVehicles(data.vehicles ?? []))
      .catch(() => {});
  }, []);

  async function patchProduct(
    body: Record<string, unknown>,
    successMessage: string
  ) {
    const res = await fetch(`/api/products/${params.id}`, {
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

  async function handleSaveBasics() {
    if (!productName.trim()) {
      toast.error('Product name is required.');
      return;
    }
    setSavingBasics(true);
    try {
      await patchProduct(
        {
          product_name: productName.trim(),
          product_code: productCode.trim() || null,
          category_id: categoryId === NO_CATEGORY ? null : categoryId,
          short_description: shortDescription.trim() || null,
          description: description.trim() || null,
          long_description: longDescription.trim() || null,
          packaging: packaging.trim() || null,
          key_features: keyFeatures,
          benefits: benefits,
          vehicle_types: vehicleTypes,
          recommended_vehicles: recommendedVehicles,
          engine_types: engineTypes,
        },
        'Saved.'
      );
    } finally {
      setSavingBasics(false);
    }
  }

  async function handleStatusChange(status: string) {
    setBusy(true);
    try {
      await patchProduct({ status }, `Status set to ${STATUS_LABEL[status]}.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!product) return;
    if (!confirm(`Delete "${product.product_name}"? This cannot be undone.`))
      return;
    const res = await fetch(`/api/products/${product.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || 'Failed to delete.');
      return;
    }
    toast.success('Product deleted.');
    router.push('/products');
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !product) return;
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error(
        `Image is too large (max ${MEDIA_MAX_BYTES_BY_KIND.image / (1024 * 1024)} MB).`
      );
      return;
    }
    setUploading(true);
    try {
      const { path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
      const res = await fetch(`/api/products/${product.id}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storage_path: path }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to attach image.');
        return;
      }
      toast.success('Image added.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveImage(imageId: string) {
    if (!product) return;
    const res = await fetch(`/api/products/${product.id}/images/${imageId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || 'Failed to remove image.');
      return;
    }
    await load();
  }

  async function handleAddApplication() {
    if (!product || !applicationDraft.trim()) return;
    const res = await fetch(`/api/products/${product.id}/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        application: applicationDraft.trim(),
        notes: applicationNotesDraft.trim() || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || 'Failed to add application.');
      return;
    }
    setApplicationDraft('');
    setApplicationNotesDraft('');
    await load();
  }

  async function handleRemoveApplication(appId: string) {
    if (!product) return;
    const res = await fetch(
      `/api/products/${product.id}/applications/${appId}`,
      {
        method: 'DELETE',
      }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || 'Failed to remove application.');
      return;
    }
    await load();
  }

  async function handleAddClaim() {
    if (!product || !claimDraft.trim()) return;
    const res = await fetch(`/api/products/${product.id}/claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim_text: claimDraft.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || 'Failed to add claim.');
      return;
    }
    setClaimDraft('');
    await load();
  }

  async function handleClaimStatus(claimId: string, status: string) {
    if (!product) return;
    const res = await fetch(`/api/products/${product.id}/claims/${claimId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || 'Failed to update claim.');
      return;
    }
    await load();
  }

  async function handleRemoveClaim(claimId: string) {
    if (!product) return;
    const res = await fetch(`/api/products/${product.id}/claims/${claimId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || 'Failed to remove claim.');
      return;
    }
    await load();
  }

  async function handleAddCompatibility() {
    if (!product || !selectedVehicleId) return;
    const res = await fetch(`/api/products/${product.id}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vehicle_id: selectedVehicleId,
        notes: compatNotesDraft.trim() || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || 'Failed to record compatibility.');
      return;
    }
    setSelectedVehicleId('');
    setCompatNotesDraft('');
    toast.success('Compatibility recorded.');
    await load();
  }

  async function handleRemoveCompatibility(compatId: string) {
    if (!product) return;
    const res = await fetch(
      `/api/products/${product.id}/vehicles/${compatId}`,
      {
        method: 'DELETE',
      }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || 'Failed to remove compatibility.');
      return;
    }
    await load();
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (!product) {
    return <p className="text-muted-foreground text-sm">Product not found.</p>;
  }

  const alreadyCompatibleIds = new Set(
    product.compatible_vehicles
      .map((cv) => oneOf(cv.vehicle)?.id)
      .filter(Boolean)
  );
  const availableVehicles = allVehicles.filter(
    (v) => !alreadyCompatibleIds.has(v.id)
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-foreground text-2xl font-bold">
              {product.product_name}
            </h1>
            <Badge variant="outline">
              {STATUS_LABEL[product.status] ?? product.status}
            </Badge>
          </div>
          {product.product_code && (
            <p className="text-muted-foreground mt-1 text-sm">
              {product.product_code}
            </p>
          )}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Select
              value={product.status}
              onValueChange={(v) => v && void handleStatusChange(v)}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
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

      <ProductAnalytics analytics={analytics} loading={analyticsLoading} />

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Basics</CardTitle>
          <CardDescription>
            Only Published, admin-entered data is shown to customers as fact
            (§2) — everything here is data entry, not automatically verified.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="product-name">Product name</Label>
              <Input
                id="product-name"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-code">Product code</Label>
              <Input
                id="product-code"
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
                disabled={!isAdmin}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="product-category">Category</Label>
            <Select
              value={categoryId}
              onValueChange={(v) => v && setCategoryId(v)}
            >
              <SelectTrigger id="product-category" disabled={!isAdmin}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>No category</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="product-short-description">Short description</Label>
            <Input
              id="product-short-description"
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              disabled={!isAdmin}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="product-description">Description</Label>
            <Textarea
              id="product-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!isAdmin}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="product-long-description">Long description</Label>
            <Textarea
              id="product-long-description"
              rows={5}
              value={longDescription}
              onChange={(e) => setLongDescription(e.target.value)}
              disabled={!isAdmin}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="product-packaging">Packaging</Label>
            <Input
              id="product-packaging"
              value={packaging}
              onChange={(e) => setPackaging(e.target.value)}
              placeholder="e.g. 20L pail, 200L drum"
              disabled={!isAdmin}
            />
          </div>

          <TagListEditor
            label="Key features"
            items={keyFeatures}
            onChange={setKeyFeatures}
            disabled={!isAdmin}
            placeholder="Add a feature and press Enter"
          />
          <TagListEditor
            label="Benefits"
            items={benefits}
            onChange={setBenefits}
            disabled={!isAdmin}
            placeholder="Add a benefit and press Enter"
          />
          <TagListEditor
            label="Vehicle types (summary)"
            items={vehicleTypes}
            onChange={setVehicleTypes}
            disabled={!isAdmin}
            placeholder="e.g. Heavy Truck"
          />
          <TagListEditor
            label="Recommended vehicles (summary)"
            items={recommendedVehicles}
            onChange={setRecommendedVehicles}
            disabled={!isAdmin}
            placeholder="e.g. Hino 500 Series"
          />
          <TagListEditor
            label="Engine types (summary)"
            items={engineTypes}
            onChange={setEngineTypes}
            disabled={!isAdmin}
            placeholder="e.g. Diesel, Euro V"
          />
          <p className="text-muted-foreground text-xs">
            These are free-text summary fields for quick display. The
            &ldquo;Verified compatibility&rdquo; section below is the source of
            truth for anything shown to a customer as a confirmed match (§11).
          </p>

          {isAdmin && (
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handleSaveBasics}
                disabled={savingBasics}
              >
                {savingBasics ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                Save
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Images</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {product.images.length > 0 && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {product.images
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((img) => (
                  <div key={img.id} className="group relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={getAccountMediaPublicUrl(
                        CHAT_MEDIA_BUCKET,
                        img.storage_path
                      )}
                      alt={img.alt_text ?? ''}
                      className="border-border aspect-square w-full rounded-md border object-cover"
                    />
                    {isAdmin && (
                      <button
                        type="button"
                        aria-label="Remove image"
                        onClick={() => void handleRemoveImage(img.id)}
                        className="bg-background/90 text-foreground absolute top-1 right-1 flex size-6 items-center justify-center rounded-full opacity-0 shadow transition-opacity group-hover:opacity-100"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                ))}
            </div>
          )}
          {isAdmin && (
            <label className="border-border text-muted-foreground hover:bg-muted flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-4 text-sm">
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {uploading ? 'Uploading...' : 'Upload image'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
                disabled={uploading}
              />
            </label>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Applications</CardTitle>
          <CardDescription>
            Where this product is used — separate rows so each can carry its own
            notes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {product.applications.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No applications recorded yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {product.applications.map((app) => (
                <li
                  key={app.id}
                  className="border-border flex items-start justify-between gap-3 rounded-md border p-3"
                >
                  <div>
                    <p className="text-foreground text-sm font-medium">
                      {app.application}
                    </p>
                    {app.notes && (
                      <p className="text-muted-foreground text-xs">
                        {app.notes}
                      </p>
                    )}
                  </div>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void handleRemoveApplication(app.id)}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {isAdmin && (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                value={applicationDraft}
                onChange={(e) => setApplicationDraft(e.target.value)}
                placeholder="Application, e.g. Highway hauling"
              />
              <Input
                value={applicationNotesDraft}
                onChange={(e) => setApplicationNotesDraft(e.target.value)}
                placeholder="Notes (optional)"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleAddApplication()}
                disabled={!applicationDraft.trim()}
              >
                <Plus className="size-4" />
                Add
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">
            Verified compatibility
          </CardTitle>
          <CardDescription>
            The only source of truth shown to a customer as a confirmed vehicle
            match (§11) — an admin is asserting this pairing has been checked,
            not an automated match.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {product.compatible_vehicles.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No verified compatibility recorded yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {product.compatible_vehicles.map((cv) => {
                const v = oneOf(cv.vehicle);
                return (
                  <li
                    key={cv.id}
                    className="border-border flex items-start justify-between gap-3 rounded-md border p-3"
                  >
                    <div>
                      <p className="text-foreground text-sm font-medium">
                        {v
                          ? `${v.vehicle_type} — ${v.manufacturer} ${v.model}${v.engine ? ` (${v.engine})` : ''}`
                          : 'Unknown vehicle'}
                      </p>
                      {cv.notes && (
                        <p className="text-muted-foreground text-xs">
                          {cv.notes}
                        </p>
                      )}
                    </div>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void handleRemoveCompatibility(cv.id)}
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {isAdmin && (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Select
                  value={selectedVehicleId}
                  onValueChange={(v) => v && setSelectedVehicleId(v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a vehicle" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableVehicles.length === 0 ? (
                      <SelectItem value="__empty__" disabled>
                        No vehicles available
                      </SelectItem>
                    ) : (
                      availableVehicles.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.vehicle_type} — {v.manufacturer} {v.model}
                          {v.engine ? ` (${v.engine})` : ''}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Input
                  value={compatNotesDraft}
                  onChange={(e) => setCompatNotesDraft(e.target.value)}
                  placeholder="Notes (optional)"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleAddCompatibility()}
                  disabled={!selectedVehicleId}
                >
                  <Plus className="size-4" />
                  Add
                </Button>
              </div>
              <Link
                href="/products/vehicles"
                className="text-primary text-xs hover:underline"
              >
                Manage the vehicle list
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Claims</CardTitle>
          <CardDescription>
            Only{' '}
            <Badge variant="default" className="align-middle">
              Approved
            </Badge>{' '}
            claims may be shown to a customer as fact (§2).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {product.claims.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No claims recorded yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {product.claims.map((claim) => (
                <li
                  key={claim.id}
                  className="border-border flex items-start justify-between gap-3 rounded-md border p-3"
                >
                  <div>
                    <p className="text-foreground text-sm">
                      {claim.claim_text}
                    </p>
                    <Badge
                      variant={CLAIM_STATUS_VARIANT[claim.status] ?? 'outline'}
                      className="mt-1"
                    >
                      {claim.status.replace('_', ' ')}
                    </Badge>
                  </div>
                  {isAdmin && (
                    <div className="flex shrink-0 items-center gap-1">
                      {claim.status !== 'approved' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Approve"
                          onClick={() =>
                            void handleClaimStatus(claim.id, 'approved')
                          }
                        >
                          <Check className="size-4" />
                        </Button>
                      )}
                      {claim.status !== 'rejected' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Reject"
                          onClick={() =>
                            void handleClaimStatus(claim.id, 'rejected')
                          }
                        >
                          <Ban className="size-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete"
                        onClick={() => void handleRemoveClaim(claim.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {isAdmin && (
            <div className="flex gap-2">
              <Textarea
                value={claimDraft}
                onChange={(e) => setClaimDraft(e.target.value)}
                placeholder="e.g. Meets API CI-4 Plus specification"
                rows={2}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleAddClaim()}
                disabled={!claimDraft.trim()}
              >
                <Plus className="size-4" />
                Add
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Link
        href="/products"
        className={buttonVariants({ variant: 'outline', className: 'w-fit' })}
      >
        Back to Products
      </Link>
    </div>
  );
}
