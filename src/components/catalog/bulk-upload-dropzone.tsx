'use client'

import { DragEvent, useState } from 'react'
import { UploadCloud } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

const ACCEPTED = 'image/jpeg,image/png,image/webp,image/gif'

/**
 * Drag-and-drop photo picker for the bulk uploader. A real <label>
 * wraps a visually-hidden <input type="file"> so Tab/Enter/Space and
 * screen readers get native file-input behaviour for free — the drag
 * handlers on the outer element are a pure enhancement on top, not a
 * replacement for it.
 */
export function BulkUploadDropzone({
  onFiles,
  disabled = false,
}: {
  onFiles: (files: File[]) => void
  disabled?: boolean
}) {
  const [dragOver, setDragOver] = useState(false)

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    if (disabled) return
    const files = Array.from(e.dataTransfer.files ?? []).filter((file) => file.type.startsWith('image/'))
    if (files.length > 0) onFiles(files)
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={cn(
        'flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors',
        dragOver ? 'border-primary bg-primary/5' : 'border-border',
        disabled && 'opacity-50',
      )}
    >
      <UploadCloud className="h-8 w-8 text-muted-foreground" aria-hidden />
      <label className="flex cursor-pointer flex-col items-center gap-2">
        <span className="text-sm font-medium">Arrasta as fotografias para aqui</span>
        <span className="text-xs text-muted-foreground">ou</span>
        <span className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>Seleccionar fotos</span>
        <input
          type="file"
          multiple
          accept={ACCEPTED}
          disabled={disabled}
          className="sr-only"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) onFiles(files)
            e.target.value = ''
          }}
        />
      </label>
      <p className="mt-1 text-xs text-muted-foreground">JPG, PNG, WEBP · até 5 MB cada · várias fotos de uma vez</p>
    </div>
  )
}
