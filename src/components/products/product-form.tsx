'use client';

import { readResponseJson } from '@/lib/http/response-json';

import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import type { Product } from '@/types';
import {
  uploadAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';
import { MAX_PRICE_OPTIONS } from '@/lib/products/price-options';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Loader2, Plus, Upload, X } from 'lucide-react';

interface ProductFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: Product | null;
  onSaved: () => void;
}

interface PriceOptionDraft {
  label: string;
  price: string;
  installationCost: string;
  imageUrls: string[];
}

function emptyPriceOptionDraft(): PriceOptionDraft {
  return { label: '', price: '', installationCost: '', imageUrls: [] };
}

export function ProductForm({
  open,
  onOpenChange,
  product,
  onSaved,
}: ProductFormProps) {
  const t = useTranslations('Products.form');
  const isEdit = !!product;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [priceOptions, setPriceOptions] = useState<PriceOptionDraft[]>([]);
  // Index of the option currently uploading a photo, or 'new' while
  // adding a brand-new option's first photo before it has an index of
  // its own — null means nothing is uploading.
  const [uploadingOptionIndex, setUploadingOptionIndex] = useState<
    number | null
  >(null);
  const optionFileInputRef = useRef<HTMLInputElement>(null);
  const pendingOptionIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(product?.name ?? '');
    setDescription(product?.description ?? '');
    setPrice(product ? String(product.price) : '');
    setImageUrl(product?.image_url ?? '');
    setIsActive(product?.is_active ?? true);
    setPriceOptions(
      (product?.price_options ?? []).map((option) => ({
        label: option.label,
        price: String(option.price),
        installationCost:
          option.installation_cost != null ? String(option.installation_cost) : '',
        imageUrls: option.image_urls ?? [],
      }))
    );
  }, [open, product]);

  function addPriceOption() {
    setPriceOptions((prev) =>
      prev.length >= MAX_PRICE_OPTIONS ? prev : [...prev, emptyPriceOptionDraft()]
    );
  }

  function removePriceOption(index: number) {
    setPriceOptions((prev) => prev.filter((_, i) => i !== index));
  }

  function updatePriceOption(index: number, patch: Partial<PriceOptionDraft>) {
    setPriceOptions((prev) =>
      prev.map((option, i) => (i === index ? { ...option, ...patch } : option))
    );
  }

  async function handlePriceOptionImageFile(index: number, file: File) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error(t('toastInvalidImage'));
      return;
    }
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error(t('toastImageTooLarge'));
      return;
    }
    setUploadingOptionIndex(index);
    try {
      const { publicUrl } = await uploadAccountMedia('product-media', file);
      updatePriceOption(index, {
        imageUrls: [...priceOptions[index].imageUrls, publicUrl],
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastUploadFailed'));
    } finally {
      setUploadingOptionIndex(null);
    }
  }

  function removePriceOptionImage(optionIndex: number, imageIndex: number) {
    updatePriceOption(optionIndex, {
      imageUrls: priceOptions[optionIndex].imageUrls.filter(
        (_, i) => i !== imageIndex
      ),
    });
  }

  async function handleImageFile(file: File) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error(t('toastInvalidImage'));
      return;
    }
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error(t('toastImageTooLarge'));
      return;
    }
    setUploading(true);
    try {
      const { publicUrl } = await uploadAccountMedia('product-media', file);
      setImageUrl(publicUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastUploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error(t('toastNameRequired'));
      return;
    }
    const priceValue = Number(price);
    if (!Number.isFinite(priceValue) || priceValue < 0) {
      toast.error(t('toastPriceInvalid'));
      return;
    }

    const resolvedPriceOptions: {
      label: string;
      price: number;
      installation_cost: number | null;
      image_urls: string[];
    }[] = [];
    for (const option of priceOptions) {
      const label = option.label.trim();
      if (!label) {
        toast.error(t('toastPriceOptionLabelRequired'));
        return;
      }
      const optionPrice = Number(option.price);
      if (!Number.isFinite(optionPrice) || optionPrice < 0) {
        toast.error(t('toastPriceOptionPriceInvalid'));
        return;
      }
      let installationCost: number | null = null;
      if (option.installationCost.trim() !== '') {
        const parsed = Number(option.installationCost);
        if (!Number.isFinite(parsed) || parsed < 0) {
          toast.error(t('toastPriceOptionInstallationInvalid'));
          return;
        }
        installationCost = parsed;
      }
      resolvedPriceOptions.push({
        label,
        price: optionPrice,
        installation_cost: installationCost,
        image_urls: option.imageUrls,
      });
    }

    setSaving(true);
    try {
      const body = {
        name: trimmedName,
        description: description.trim() || null,
        price: priceValue,
        image_url: imageUrl || null,
        is_active: isActive,
        price_options: resolvedPriceOptions,
      };
      const res = await fetch(
        isEdit ? `/api/products/${product.id}` : '/api/products',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const data = await readResponseJson(res).catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('toastSaveFailed'));
        return;
      }
      toast.success(isEdit ? t('toastSuccessEdit') : t('toastSuccessAdd'));
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {isEdit ? t('editTitle') : t('addTitle')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {isEdit ? t('editDesc') : t('addDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('nameLabel')}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
              className="bg-muted border-border text-foreground"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground">
              {t('descriptionLabel')}
            </Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('descriptionPlaceholder')}
              className="bg-muted border-border text-foreground"
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('priceLabel')}</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className="bg-muted border-border text-foreground"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('imageLabel')}</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImageFile(f);
                e.target.value = '';
              }}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="border-border text-muted-foreground hover:bg-muted"
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                {t('uploadImageBtn')}
              </Button>
              {imageUrl && (
                <span className="text-muted-foreground truncate text-xs">
                  {t('imageUploaded')}
                </span>
              )}
            </div>
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt={t('imagePreviewAlt')}
                className="border-border mt-2 h-20 w-20 rounded-md border object-cover"
              />
            )}
          </div>

          <div className="space-y-2">
            <div>
              <Label className="text-muted-foreground">
                {t('priceOptionsTitle')}
              </Label>
              <p className="text-muted-foreground text-xs">
                {t('priceOptionsDesc')}
              </p>
            </div>

            <input
              ref={optionFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                const index = pendingOptionIndexRef.current;
                if (f && index !== null) void handlePriceOptionImageFile(index, f);
                e.target.value = '';
              }}
            />

            {priceOptions.map((option, index) => (
              <div
                key={index}
                className="border-border space-y-3 rounded-md border p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 space-y-1.5">
                    <Label className="text-muted-foreground text-xs">
                      {t('priceOptionLabelLabel')}
                    </Label>
                    <Input
                      value={option.label}
                      onChange={(e) =>
                        updatePriceOption(index, { label: e.target.value })
                      }
                      placeholder={t('priceOptionLabelPlaceholder')}
                      className="bg-muted border-border text-foreground"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removePriceOption(index)}
                    className="text-muted-foreground hover:text-foreground mt-5 shrink-0"
                    aria-label={t('removePriceOption')}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">
                      {t('priceOptionPriceLabel')}
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={option.price}
                      onChange={(e) =>
                        updatePriceOption(index, { price: e.target.value })
                      }
                      placeholder="0.00"
                      className="bg-muted border-border text-foreground"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">
                      {t('priceOptionInstallationLabel')}
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={option.installationCost}
                      onChange={(e) =>
                        updatePriceOption(index, {
                          installationCost: e.target.value,
                        })
                      }
                      placeholder={t('priceOptionInstallationPlaceholder')}
                      className="bg-muted border-border text-foreground"
                    />
                  </div>
                </div>
                <p className="text-muted-foreground text-xs">
                  {t('priceOptionInstallationHint')}
                </p>

                <div className="space-y-1.5">
                  <Label className="text-muted-foreground text-xs">
                    {t('priceOptionPhotosLabel')}
                  </Label>
                  <div className="flex flex-wrap items-center gap-2">
                    {option.imageUrls.map((url, imageIndex) => (
                      <div key={url} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt=""
                          className="border-border h-14 w-14 rounded-md border object-cover"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            removePriceOptionImage(index, imageIndex)
                          }
                          className="bg-background/80 text-foreground hover:bg-background absolute -top-1.5 -right-1.5 rounded-full p-0.5"
                          aria-label={t('removePriceOption')}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploadingOptionIndex === index}
                      onClick={() => {
                        pendingOptionIndexRef.current = index;
                        optionFileInputRef.current?.click();
                      }}
                      className="border-border text-muted-foreground hover:bg-muted"
                    >
                      {uploadingOptionIndex === index ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" />
                      )}
                      {t('uploadPhotoBtn')}
                    </Button>
                  </div>
                </div>
              </div>
            ))}

            {priceOptions.length < MAX_PRICE_OPTIONS && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addPriceOption}
                className="border-border text-muted-foreground hover:bg-muted"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('addPriceOption')}
              </Button>
            )}
          </div>

          <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <p className="text-foreground text-sm font-medium">
                {t('activeLabel')}
              </p>
              <p className="text-muted-foreground text-xs">{t('activeDesc')}</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t('cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || uploading}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? t('update') : t('create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
