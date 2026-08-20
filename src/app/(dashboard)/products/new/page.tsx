'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
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

interface Category {
  id: string;
  name: string;
}

const NO_CATEGORY = '__none__';

export default function NewProductPage() {
  const router = useRouter();
  const [productName, setProductName] = useState('');
  const [productCode, setProductCode] = useState('');
  const [categoryId, setCategoryId] = useState<string>(NO_CATEGORY);
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [shortDescription, setShortDescription] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/product-categories')
      .then((res) => res.json())
      .then((data) => setCategories(data.categories ?? []))
      .catch(() => {});
  }, []);

  async function handleAddCategory() {
    const name = newCategory.trim();
    if (!name) return;
    setAddingCategory(true);
    try {
      const res = await fetch('/api/product-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to add category.');
        return;
      }
      setCategories((c) =>
        [...c, data.category].sort((a, b) => a.name.localeCompare(b.name))
      );
      setCategoryId(data.category.id);
      setNewCategory('');
      toast.success('Category added.');
    } finally {
      setAddingCategory(false);
    }
  }

  async function handleCreate() {
    if (!productName.trim()) {
      toast.error('Product name is required.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: productName.trim(),
          product_code: productCode.trim() || null,
          category_id: categoryId === NO_CATEGORY ? null : categoryId,
          short_description: shortDescription.trim() || null,
          description: description.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to create product.');
        return;
      }
      toast.success('Product created.');
      router.push(`/products/${data.product.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-foreground text-2xl font-bold">New product</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Images, features, applications, verified vehicle compatibility, and
          claims are added after creation.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Basics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="product-name">Product name</Label>
            <Input
              id="product-name"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="e.g. Rimula R4 X 15W-40"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="product-code">Product code (optional)</Label>
            <Input
              id="product-code"
              value={productCode}
              onChange={(e) => setProductCode(e.target.value)}
              placeholder="e.g. RIM-R4X-15W40-20L"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="product-category">Category</Label>
            <Select
              value={categoryId}
              onValueChange={(v) => v && setCategoryId(v)}
            >
              <SelectTrigger id="product-category">
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
            <div className="flex gap-2 pt-1">
              <Input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAddCategory();
                  }
                }}
                placeholder="Add a new category"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => void handleAddCategory()}
                disabled={addingCategory || !newCategory.trim()}
              >
                {addingCategory ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="product-short-description">Short description</Label>
            <Input
              id="product-short-description"
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              placeholder="One line for list views and product cards"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="product-description">Description</Label>
            <Textarea
              id="product-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => router.push('/products')}>
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
