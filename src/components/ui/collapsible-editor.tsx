'use client'

import { ReactNode } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * View-mode / edit-mode shell for a persisted entity or setting: a
 * summary row (`header`) is always visible; clicking it (or the
 * "Editar" affordance) reveals `children` — the actual edit form —
 * below a divider, with Cancelar/Guardar actions. Collapses back to
 * the summary after a successful save (the caller drives `editing`,
 * this component has no state of its own).
 *
 * Used for entities in a list (Skills, Tools, taxonomy terms, ...) —
 * not for search bars, filters, message composers, or the Playground.
 */
export function CollapsibleEditor({
  header,
  headerActions,
  editing,
  onToggle,
  onCancel,
  onSave,
  saving = false,
  canEdit = true,
  saveLabel = 'Guardar alterações',
  disableSave = false,
  className,
  children,
}: {
  header: ReactNode
  /** Rendered as a sibling of the toggle button, not inside it — for
   *  controls (e.g. a Switch) that must stay independently clickable
   *  without also triggering expand/collapse. */
  headerActions?: ReactNode
  editing: boolean
  onToggle: () => void
  onCancel: () => void
  onSave: () => void | Promise<void>
  saving?: boolean
  canEdit?: boolean
  saveLabel?: string
  disableSave?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <Card className={className}>
      <div className="flex items-start gap-3 p-4">
        <button
          type="button"
          onClick={onToggle}
          disabled={!canEdit}
          aria-expanded={editing}
          className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left disabled:cursor-default"
        >
          <div className="min-w-0 flex-1">{header}</div>
          {canEdit ? (
            <ChevronDown
              aria-hidden
              className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform', editing && 'rotate-180')}
            />
          ) : null}
        </button>
        {headerActions ? <div className="shrink-0">{headerActions}</div> : null}
      </div>
      {editing ? (
        <CardContent className="animate-in fade-in slide-in-from-top-1 space-y-4 border-t pt-4 duration-150">
          {children}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void onSave()} disabled={saving || disableSave}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              {saveLabel}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
              Cancelar
            </Button>
          </div>
        </CardContent>
      ) : null}
    </Card>
  )
}
