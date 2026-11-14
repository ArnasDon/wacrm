'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  ShoppingBag,
  Plus,
  Search,
  Edit2,
  Trash2,
  Loader2,
  Tag,
  Package,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import Image from 'next/image';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { uploadAccountMedia, MEDIA_MAX_BYTES_BY_KIND } from '@/lib/storage/upload-media';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { Product } from '@/lib/commerce/types';

export default function ProductsPage() {
  const { accountRole, defaultCurrency } = useAuth();
  const canManage = accountRole ? canEditSettings(accountRole) : false;

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [sku, setSku] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageFileName, setImageFileName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getDisplayImageName = (url: string, storedName?: string) => {
    if (storedName) return storedName;
    if (!url) return '';
    try {
      const raw = new URL(url).pathname.split('/').pop() || url;
      return decodeURIComponent(raw.replace(/^\d+[-_]/, ''));
    } catch {
      return url.split('/').pop() || url;
    }
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file (PNG, JPG, WebP)');
      return;
    }
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error('Image must be under 5 MB');
      return;
    }

    setUploadingImage(true);
    try {
      const res = await uploadAccountMedia('chat-media', file);
      setImageUrl(res.publicUrl);
      setImageFileName(file.name);
      toast.success('Picture uploaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload picture');
    } finally {
      setUploadingImage(false);
    }
  };

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/products');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load products');
      setProducts(data.products || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error loading catalog');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  const openCreateModal = () => {
    setEditingId(null);
    setTitle('');
    setDescription('');
    setPrice('');
    setCurrency(defaultCurrency || 'INR');
    setSku('');
    setImageUrl('');
    setImageFileName('');
    setIsActive(true);
    setModalOpen(true);
  };

  const openEditModal = (p: Product) => {
    setEditingId(p.id);
    setTitle(p.title);
    setDescription(p.description || '');
    setPrice(p.price.toString());
    setCurrency(p.currency);
    setSku(p.sku || '');
    setImageUrl(p.image_url || '');
    setImageFileName('');
    setIsActive(p.is_active);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice < 0) {
      toast.error('Enter a valid price');
      return;
    }

    setSaving(true);
    try {
      const url = editingId ? `/api/products/${editingId}` : '/api/products';
      const method = editingId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          price: numPrice,
          currency,
          sku,
          image_url: imageUrl,
          is_active: isActive,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save product');

      toast.success(editingId ? 'Product updated' : 'Product added to catalog');
      setModalOpen(false);
      void fetchProducts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this product?')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete product');

      toast.success('Product deleted');
      setProducts((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSeedDemo = async () => {
    setSeeding(true);
    try {
      const res = await fetch('/api/products/seed', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to seed catalog');
      toast.success(`Seeded ${data.count || 8} demo products`);
      void fetchProducts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error seeding catalog');
    } finally {
      setSeeding(false);
    }
  };

  const filtered = products.filter((p) => {
    const q = search.toLowerCase();
    return (
      p.title.toLowerCase().includes(q) ||
      (p.sku && p.sku.toLowerCase().includes(q)) ||
      (p.description && p.description.toLowerCase().includes(q))
    );
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShoppingBag className="h-5 w-5" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Product Catalog
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage products, pricing, and SKUs to instantly send payment requests and product links in WhatsApp chats.
          </p>
        </div>

        {canManage && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSeedDemo}
              disabled={seeding}
              className="flex items-center gap-1.5"
            >
              {seeding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 text-amber-500" />
              )}
              Load Demo Catalog
            </Button>
            <Button onClick={openCreateModal} className="flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add Product
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products or SKU..."
            className="pl-9"
          />
        </div>
        <Badge variant="outline" className="border-border text-xs">
          {products.length} Products
        </Badge>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading catalog...
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Package className="h-12 w-12 text-muted-foreground/60 mb-3" />
            <h3 className="font-semibold text-lg text-foreground">No products found</h3>
            <p className="text-sm text-muted-foreground max-w-sm mt-1 mb-4">
              {search
                ? 'No products match your search query.'
                : 'Your catalog is empty. Add your first item to start sending in-chat WhatsApp payment requests.'}
            </p>
            {canManage && !search && (
              <Button onClick={openCreateModal} size="sm">
                <Plus className="mr-1.5 h-4 w-4" /> Add First Product
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <Card key={item.id} className="overflow-hidden border-border transition-all hover:shadow-sm">
              {item.image_url && (
                <div className="relative aspect-video w-full overflow-hidden bg-muted">
                  <Image
                    src={item.image_url}
                    alt={item.title}
                    className="h-full w-full object-cover"
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    unoptimized
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                </div>
              )}
              <CardHeader className="p-4 pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base font-semibold truncate">
                    {item.title}
                  </CardTitle>
                  <Badge
                    variant="outline"
                    className={item.is_active ? 'border-green-500/30 text-green-600 bg-green-50/50' : 'text-muted-foreground'}
                  >
                    {item.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                {item.sku && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 font-mono">
                    <Tag className="h-3 w-3" /> {item.sku}
                  </p>
                )}
              </CardHeader>
              <CardContent className="p-4 pt-1 space-y-3">
                <p className="text-xs text-muted-foreground line-clamp-2 min-h-[32px]">
                  {item.description || 'No description provided.'}
                </p>
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <span className="text-lg font-bold text-foreground">
                    {item.currency} {Number(item.price).toLocaleString()}
                  </span>
                  {canManage && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditModal(item)}
                        className="h-8 w-8 p-0"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(item.id)}
                        disabled={deletingId === item.id}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      >
                        {deletingId === item.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Edit Product' : 'Add New Product'}
            </DialogTitle>
            <DialogDescription>
              Products in your catalog can be sent as payment links directly from the WhatsApp shared inbox.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="prod-title">Product Title *</Label>
              <Input
                id="prod-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Clay Pottery Workshop Pass"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="prod-price">Price *</Label>
                <Input
                  id="prod-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="1500"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="prod-curr">Currency</Label>
                <Input
                  id="prod-curr"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  placeholder="INR / USD"
                  maxLength={4}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prod-sku">SKU / Code (Optional)</Label>
              <Input
                id="prod-sku"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="WORKSHOP-01"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prod-img">Product Picture (Optional)</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleImageFileChange}
              />
              <div className="flex h-10 items-center gap-2">
                {imageUrl ? (
                  <div className="flex h-10 w-full min-w-0 items-center gap-2.5 rounded-md border border-border bg-muted/40 px-3">
                    <div className="relative h-7 w-7 flex-shrink-0 overflow-hidden rounded border border-border bg-background">
                      <Image
                        src={imageUrl}
                        alt="Product preview"
                        className="h-full w-full object-cover"
                        fill
                        sizes="28px"
                        unoptimized
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    </div>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                      {imageFileName || getDisplayImageName(imageUrl)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingImage}
                    >
                      {uploadingImage ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Change'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        setImageUrl('');
                        setImageFileName('');
                      }}
                      title="Remove picture"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <Input
                      id="prod-img"
                      value={imageUrl}
                      onChange={(e) => {
                        setImageUrl(e.target.value);
                        setImageFileName('');
                      }}
                      placeholder="Paste image URL or upload file"
                      className="h-10 text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-10 flex-shrink-0 px-3 text-xs"
                      disabled={uploadingImage}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploadingImage ? (
                        <>
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="mr-1.5 h-3.5 w-3.5" />
                          Upload
                        </>
                      )}
                    </Button>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prod-desc">Description (Optional)</Label>
              <Textarea
                id="prod-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Details sent to the customer with the payment request..."
                rows={3}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <Label className="text-sm font-medium">Available for Sale</Label>
                <p className="text-xs text-muted-foreground">
                  Active products appear in the inbox payment request selector.
                </p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingId ? 'Save Changes' : 'Create Product'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
