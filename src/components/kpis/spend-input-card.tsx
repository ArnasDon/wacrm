'use client'

import { useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency } from '@/lib/currency'
import { cac } from '@/lib/kpis/compute'

interface SpendInputCardProps {
  /** Pre-filled from a previously saved entry for this exact window,
   *  or null when none was ever saved. */
  savedAmount: number | null
  wonCount: number
  currency: string
  saving: boolean
  canEdit: boolean
  onSave: (amount: number) => void
}

/** No cost/expense tracking exists anywhere in this CRM, so CAC
 *  (spend ÷ customers acquired) can't be computed automatically —
 *  Angel's explicit product decision (2026-08-16): a manual spend
 *  figure per viewed period, persisted (kpi_period_spend, migration
 *  065) so it becomes a real trackable-over-time metric instead of a
 *  one-off calculator. */
export function SpendInputCard({ savedAmount, wonCount, currency, saving, canEdit, onSave }: SpendInputCardProps) {
  const t = useTranslations('Kpis.cac')
  const [value, setValue] = useState(savedAmount != null ? String(savedAmount) : '')
  // Re-sync the input whenever the underlying saved figure changes —
  // e.g. switching date ranges loads a different (or no) saved entry.
  // Adjusting state during render (React's own recommended pattern for
  // "reset local state when a prop changes") rather than in an effect,
  // which would cause an extra render pass.
  const [prevSavedAmount, setPrevSavedAmount] = useState(savedAmount)
  if (savedAmount !== prevSavedAmount) {
    setPrevSavedAmount(savedAmount)
    setValue(savedAmount != null ? String(savedAmount) : '')
  }

  const parsed = Number(value)
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0
  const cacValue = valid ? cac(parsed, wonCount) : null

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="kpi-spend" className="text-muted-foreground">
            {t('spendLabel', { currency })}
          </Label>
          <Input
            id="kpi-spend"
            type="number"
            min={0}
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!canEdit || saving}
            placeholder="0.00"
            className="w-40"
          />
        </div>
        {canEdit && (
          <Button onClick={() => valid && onSave(parsed)} disabled={!valid || saving} size="sm">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t('save')}
          </Button>
        )}
      </div>

      <div className="mt-4 rounded-lg bg-muted/40 p-4">
        <p className="text-xs text-muted-foreground">{t('resultLabel', { count: wonCount })}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
          {cacValue == null ? '—' : formatCurrency(cacValue, currency)}
        </p>
        {cacValue == null && (
          <p className="mt-1 text-xs text-muted-foreground">
            {wonCount === 0 ? t('noCustomersHint') : t('enterSpendHint')}
          </p>
        )}
      </div>
    </div>
  )
}
