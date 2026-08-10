"use client"

// ============================================================
// ProductForm — create / edit a sellable product.
//
// Digital products carry an attached file that's uploaded to the
// private `product-files` bucket on save (50 MB cap enforced by the
// shared `uploadProductFile` helper). Physical products carry a
// shipping note instead. Both kinds share the same fields the
// `send_product` automation step reads: name, description, price,
// currency, payment_link.
//
// The form talks to the API routes, not the DB directly — the routes
// own the agent+ role gate and the file-metadata column mapping.
// ============================================================

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { FileText, Loader2, Upload, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useAuth } from "@/hooks/use-auth"
import { CURRENCIES } from "@/lib/currency"
import {
  uploadProductFile,
  type UploadedProductFile,
} from "@/lib/products/upload"
import { formatProductPrice } from "@/lib/products/messages"
import type { Product, ProductKind } from "@/types"

interface ProductFormProps {
  /** When editing, the row to prefill. When creating, omit/leave null. */
  initial?: Product | null
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ProductForm({ initial = null }: ProductFormProps) {
  const t = useTranslations("Products.product")
  const router = useRouter()
  const { accountId, defaultCurrency } = useAuth()

  const [name, setName] = useState(initial?.name ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [price, setPrice] = useState(initial?.price != null ? String(initial.price) : "")
  const [currency, setCurrency] = useState(initial?.currency ?? defaultCurrency)
  const [kind, setKind] = useState<ProductKind>(initial?.kind ?? "digital")
  const [paymentLink, setPaymentLink] = useState(initial?.payment_link ?? "")
  const [isActive, setIsActive] = useState(initial?.is_active ?? true)

  // The freshly-uploaded replacement (or new file in create mode).
  const [file, setFile] = useState<UploadedProductFile | null>(null)
  // Existing attached file (edit mode) — shown for context until replaced.
  const [existingFile] = useState(initial?.file_name ? initial.file_name : null)
  // True when the user explicitly removed the existing file.
  const [fileRemoved, setFileRemoved] = useState(false)

  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isEdit = Boolean(initial)

  async function handleFilePicked(input: HTMLInputElement) {
    const picked = input.files?.[0]
    input.value = ""
    if (!picked || !accountId) return
    setUploading(true)
    try {
      const uploaded = await uploadProductFile(accountId, picked)
      setFile(uploaded)
      setFileRemoved(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error(t("requiredName"))
      return
    }
    if (submitting) return

    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || undefined,
        price: Number(price) || 0,
        currency,
        kind,
        payment_link: paymentLink.trim() || undefined,
        is_active: isActive,
      }


      if (file) {
        payload.file = {
          path: file.path,
          name: file.name,
          size_bytes: file.sizeBytes,
          mime_type: file.mimeType,
        }
      } else if (fileRemoved || !isEdit) {
        // Edit: explicit removal clears the attached file. Create:
        // no file uploaded → the product is file-less (physical or a
        // digital product whose delivery is arranged off-platform).
        payload.file = null
      }

      const res = await fetch(isEdit ? `/api/products/${initial!.id}` : "/api/products", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? "Failed to save product")
        return
      }
      toast.success(t("saved"))
      router.push("/products")
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  const priceNumber = Number(price)
  const pricePreview =
    Number.isFinite(priceNumber) && priceNumber >= 0
      ? formatProductPrice(priceNumber, currency)
      : null

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-4">
        {/* Name */}
        <div className="space-y-1.5">
          <label htmlFor="product-name" className="text-sm font-medium text-foreground">
            {t("name")} *
          </label>
          <Input
            id="product-name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            className="bg-muted text-foreground"
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label htmlFor="product-description" className="text-sm font-medium text-foreground">
            {t("description")}
          </label>
          <Textarea
            id="product-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("descriptionPlaceholder")}
            className="min-h-20 bg-muted text-foreground"
          />
        </div>

        {/* Price + currency */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="product-price" className="text-sm font-medium text-foreground">
              {t("price")}
            </label>
            <Input
              id="product-price"
              type="number"
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={t("pricePlaceholder")}
              className="bg-muted text-foreground"
            />
            {pricePreview ? (
              <p className="text-xs text-muted-foreground">{pricePreview}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="product-currency" className="text-sm font-medium text-foreground">
              {t("currency")}
            </label>
            <select
              id="product-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Kind */}
        <div className="space-y-2">
          <span className="text-sm font-medium text-foreground">{t("kind")}</span>
          <RadioGroup value={kind} onValueChange={(v) => setKind(v as ProductKind)}>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-card p-3">
              <RadioGroupItem value="digital" className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{t("digital")}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{t("digitalHint")}</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-card p-3">
              <RadioGroupItem value="physical" className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{t("physical")}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{t("physicalHint")}</span>
              </span>
            </label>
          </RadioGroup>
        </div>

        {/* Digital file */}
        {kind === "digital" && (
          <div className="space-y-2 rounded-lg border border-border bg-card p-3">
            <span className="text-sm font-medium text-foreground">{t("file")}</span>
            <p className="text-xs text-muted-foreground">{t("fileHint")}</p>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => handleFilePicked(e.target)}
            />
            {file ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
                <FileText className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{file.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatBytes(file.sizeBytes)}
                </span>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  aria-label={t("removeFile")}
                  className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : existingFile && !fileRemoved ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
                <FileText className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{existingFile}</span>
                <button
                  type="button"
                  onClick={() => setFileRemoved(true)}
                  aria-label={t("removeFile")}
                  className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t("noFile")}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t("uploading")}
                  </>
                ) : (
                  <>
                    <Upload className="h-3.5 w-3.5" />
                    {file || (existingFile && !fileRemoved) ? t("replaceFile") : t("uploadFile")}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Payment link */}
        <div className="space-y-1.5">
          <label htmlFor="product-payment-link" className="text-sm font-medium text-foreground">
            {t("paymentLink")}
          </label>
          <Input
            id="product-payment-link"
            type="url"
            value={paymentLink}
            onChange={(e) => setPaymentLink(e.target.value)}
            placeholder={t("paymentLinkPlaceholder")}
            className="bg-muted text-foreground"
          />
          <p className="text-xs text-muted-foreground">{t("paymentLinkHint")}</p>
        </div>

        {/* Active toggle */}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
          <div>
            <div className="text-sm font-medium text-foreground">{t("active")}</div>
            <div className="text-xs text-muted-foreground">{t("activeHint")}</div>
          </div>
          <Switch checked={isActive} onCheckedChange={setIsActive} aria-label={t("active")} />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/products")}
          disabled={submitting}
        >
          {t("cancel")}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("saving")}
            </>
          ) : (
            t("save")
          )}
        </Button>
      </div>
    </div>
  )
}
