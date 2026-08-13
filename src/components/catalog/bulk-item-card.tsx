'use client'

import { Loader2, Sparkles, Trash2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { AttributeSelect, type AttributeOption } from './attribute-select'

export interface BulkItem {
  id: string
  file: File
  previewUrl: string
  imageUrl: string | null
  uploading: boolean
  classifying: boolean
  name: string
  price: string
  category: string | null
  color: string | null
  description: string
  error?: string
}

export function isBulkItemComplete(item: BulkItem): boolean {
  return Boolean(item.imageUrl) && item.name.trim().length > 0 && item.price !== '' && Number(item.price) >= 0
}

export function BulkItemCard({
  item,
  categoryOptions,
  colorOptions,
  onCreateCategory,
  onCreateColor,
  onChange,
  onRemove,
}: {
  item: BulkItem
  categoryOptions: AttributeOption[]
  colorOptions: AttributeOption[]
  onCreateCategory: (label: string) => Promise<string | null>
  onCreateColor: (label: string) => Promise<string | null>
  onChange: (patch: Partial<BulkItem>) => void
  onRemove: () => void
}) {
  const complete = isBulkItemComplete(item)
  const busy = item.uploading || item.classifying

  return (
    <Card>
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
        {busy ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-background/80 text-xs text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            {item.classifying ? (
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3" />A analisar com IA…
              </span>
            ) : (
              <span>A carregar…</span>
            )}
          </div>
        ) : null}
        <Badge
          variant={complete ? 'default' : 'outline'}
          className="absolute top-2 left-2"
        >
          {complete ? 'Pronto' : 'Falta informação'}
        </Badge>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remover fotografia"
          className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm hover:bg-background"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <CardContent className="space-y-2 pt-3">
        <Input
          placeholder="Nome (obrigatório)"
          value={item.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <div className="grid grid-cols-2 gap-2">
          <AttributeSelect
            kind="category"
            options={categoryOptions}
            value={item.category}
            onChange={(value) => onChange({ category: value })}
            onCreate={onCreateCategory}
          />
          <AttributeSelect
            kind="color"
            options={colorOptions}
            value={item.color}
            onChange={(value) => onChange({ color: value })}
            onCreate={onCreateColor}
          />
        </div>
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder="Preço (obrigatório)"
          value={item.price}
          onChange={(e) => onChange({ price: e.target.value })}
        />
        <Textarea
          placeholder="Descrição"
          rows={2}
          value={item.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
        {item.error ? <p className="text-xs text-destructive">{item.error}</p> : null}
        <button
          type="button"
          onClick={onRemove}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-3 w-3" />
          Remover
        </button>
      </CardContent>
    </Card>
  )
}
