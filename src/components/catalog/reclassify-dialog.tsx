'use client'

import { AlertTriangle, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

export type ReclassifyMode = 'fill_empty' | 'review_all'

export interface ReclassifyProgress {
  current: number
  total: number
  label: string
}

export interface ReclassifyResult {
  classified: number
  needsReview: number
  failed: number
  failedNames: string[]
}

/**
 * "Organizar produtos com IA" — confirm → progress → summary in one
 * dialog. Failures are always shown, never hidden in a silent toast.
 */
export function ReclassifyDialog({
  open,
  onOpenChange,
  totalCount,
  mode,
  onModeChange,
  onConfirm,
  running,
  progress,
  result,
  onClose,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  totalCount: number
  mode: ReclassifyMode
  onModeChange: (mode: ReclassifyMode) => void
  onConfirm: () => void
  running: boolean
  progress: ReclassifyProgress | null
  result: ReclassifyResult | null
  onClose: () => void
}) {
  const phase = result ? 'summary' : running ? 'progress' : 'confirm'

  return (
    <Dialog open={open} onOpenChange={(next) => (running ? null : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md">
        {phase === 'confirm' ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Organizar produtos com IA
              </DialogTitle>
              <DialogDescription>
                A IA vai rever <strong>{totalCount}</strong> produto{totalCount === 1 ? '' : 's'} com fotografia e vai
                sugerir categoria, cor e descrição para cada um, usando as categorias e cores que já configuraste.
              </DialogDescription>
            </DialogHeader>
            <RadioGroup value={mode} onValueChange={(value) => onModeChange(value as ReclassifyMode)} className="space-y-3">
              <label className="flex items-start gap-2.5">
                <RadioGroupItem value="fill_empty" className="mt-0.5" />
                <span className="text-sm">
                  <span className="font-medium">Preencher apenas campos vazios</span>
                  <span className="block text-muted-foreground">
                    Categoria, cor ou descrição já preenchidas por uma pessoa não são alteradas.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2.5">
                <RadioGroupItem value="review_all" className="mt-0.5" />
                <span className="text-sm">
                  <span className="font-medium">Rever todos os produtos</span>
                  <span className="block text-muted-foreground">
                    A IA substitui categoria, cor e descrição de todos os produtos, mesmo os já preenchidos.
                  </span>
                </span>
              </label>
            </RadioGroup>
            {mode === 'review_all' ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Dados já preenchidos manualmente podem ser substituídos pela sugestão da IA.
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button onClick={onConfirm} disabled={totalCount === 0}>
                <Sparkles />
                Continuar
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {phase === 'progress' && progress ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />A organizar produtos…
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="truncate text-foreground">{progress.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {progress.current} / {progress.total}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                />
              </div>
            </div>
          </>
        ) : null}

        {phase === 'summary' && result ? (
          <>
            <DialogHeader>
              <DialogTitle>Organização concluída</DialogTitle>
              <DialogDescription>
                {result.classified} classificado{result.classified === 1 ? '' : 's'}
                {result.needsReview > 0 ? `, ${result.needsReview} precisam de revisão` : ''}
                {result.failed > 0 ? `, ${result.failed} falharam` : ''}.
              </DialogDescription>
            </DialogHeader>
            {result.failed > 0 ? (
              <div className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-sm">
                <p className="flex items-center gap-1.5 font-medium text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Produtos que falharam:
                </p>
                <ul className="list-inside list-disc text-xs text-muted-foreground">
                  {result.failedNames.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <DialogFooter>
              <Button onClick={onClose}>Fechar</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
