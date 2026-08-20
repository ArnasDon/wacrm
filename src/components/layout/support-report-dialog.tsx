'use client';

import { readResponseJson } from '@/lib/http/response-json';

// ============================================================
// SupportReportDialog
//
// "Reportar un problema" — reachable from the sidebar's account menu.
// Any logged-in user can send a description + up to 5 screenshots to
// the support inbox (POST /api/support/report). Screenshots are
// emailed directly, never uploaded to Supabase Storage first.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Paperclip, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const MAX_SCREENSHOTS = 5;

interface SupportReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultName: string;
}

export function SupportReportDialog({
  open,
  onOpenChange,
  defaultName,
}: SupportReportDialogProps) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // `profile` (source of `defaultName`) can still be loading when the
  // sidebar first mounts this dialog, so the initial `useState` value
  // alone isn't reliable — re-sync every time the dialog is opened.
  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);

  function reset() {
    setName(defaultName);
    setDescription('');
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleFilesSelected(list: FileList | null) {
    if (!list) return;
    const picked = Array.from(list).slice(0, MAX_SCREENSHOTS - files.length);
    setFiles((prev) => [...prev, ...picked].slice(0, MAX_SCREENSHOTS));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error('Tu nombre es requerido');
      return;
    }
    if (!description.trim()) {
      toast.error('Describe el error que tuviste');
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set('name', name.trim());
      form.set('error_description', description.trim());
      for (const file of files) form.append('screenshots', file);

      const res = await fetch('/api/support/report', {
        method: 'POST',
        body: form,
      });
      const payload = await readResponseJson<{
        error?: string;
        ticket_number?: number;
      }>(res).catch((): { error?: string; ticket_number?: number } => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'No se pudo enviar el reporte');
        setSubmitting(false);
        return;
      }
      toast.success(
        payload.ticket_number
          ? `Reporte enviado — ticket #${payload.ticket_number}`
          : 'Reporte enviado — gracias por avisarnos'
      );
      reset();
      onOpenChange(false);
    } catch (err) {
      console.error('[support-report] submit error:', err);
      toast.error('No se pudo conectar con el servidor');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="bg-popover border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            Reportar un problema
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Cuéntanos qué pasó — si puedes, agrega capturas de pantalla.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Nombre</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-muted border-border text-foreground"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Error reportado</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Describe qué intentabas hacer y qué pasó"
              className="bg-muted border-border text-foreground"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">
              Capturas de pantalla ({files.length}/{MAX_SCREENSHOTS})
            </Label>
            {files.length > 0 && (
              <ul className="space-y-1">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="border-border bg-muted text-foreground flex items-center justify-between rounded-md border px-2 py-1 text-xs"
                  >
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Quitar"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {files.length < MAX_SCREENSHOTS && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="border-border text-foreground hover:bg-muted gap-2"
              >
                <Paperclip className="size-3.5" />
                Agregar captura
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleFilesSelected(e.target.files)}
            />
          </div>
        </div>
        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-popover-foreground hover:bg-muted"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Enviando…
              </>
            ) : (
              'Enviar reporte'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
