'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronDown, Loader2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface AttributeOption {
  value: string
  label: string
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Searchable category/colour picker backed by the account's own
 * catalog_taxonomy_terms — not a free-text input, so "pantalona",
 * "Pantalona" and "PANTALONA" can't become three different categories.
 * Offers "+ Criar <valor>" inline when nothing matches and the caller
 * allows creation (admin-only in practice, gated by the caller).
 */
export function AttributeSelect({
  kind,
  options,
  value,
  onChange,
  onCreate,
  placeholder,
  disabled = false,
}: {
  kind: 'category' | 'color'
  options: AttributeOption[]
  value: string | null
  onChange: (value: string | null) => void
  onCreate?: (label: string) => Promise<string | null>
  placeholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const filtered = useMemo(() => {
    const needle = normalize(query)
    if (!needle) return options
    return options.filter((option) => normalize(option.label).includes(needle))
  }, [options, query])

  const exactMatch = useMemo(
    () => options.some((option) => normalize(option.label) === normalize(query)),
    [options, query],
  )

  function pick(next: string | null) {
    onChange(next)
    setOpen(false)
    setQuery('')
  }

  async function handleCreate() {
    if (!onCreate || !query.trim()) return
    setCreating(true)
    try {
      const created = await onCreate(query.trim())
      if (created) pick(created)
    } finally {
      setCreating(false)
    }
  }

  const emptyLabel = kind === 'color' ? 'Sem cor' : 'Sem categoria'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className="flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={cn('truncate', !value && 'text-muted-foreground')}>
          {value || placeholder || (kind === 'color' ? 'Cor' : 'Categoria')}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="p-2">
          <Input
            autoFocus
            placeholder="Procurar..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="max-h-56 overflow-y-auto p-1">
          <button
            type="button"
            onClick={() => pick(null)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
              !value && 'bg-accent',
            )}
          >
            <span className="w-3.5">{!value ? <Check className="h-3.5 w-3.5" /> : null}</span>
            {emptyLabel}
          </button>
          {filtered.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => pick(option.value)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                value === option.value && 'bg-accent',
              )}
            >
              <span className="w-3.5">{value === option.value ? <Check className="h-3.5 w-3.5" /> : null}</span>
              {option.label}
            </button>
          ))}
          {filtered.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">Sem resultados.</p>
          ) : null}
        </div>
        {onCreate && query.trim() && !exactMatch ? (
          <div className="border-t p-1">
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-primary hover:bg-accent disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Criar &quot;{query.trim()}&quot;
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
