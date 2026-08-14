'use client';

// ============================================================
// MediaPicker — modal reutilizable para elegir una imagen del
// bucket `media` y devolver su URL pública. Se abre desde los
// campos de imagen del page editor (hero thumbs, galería, equipo…)
// y desde las filas de bloques con campos de imagen.
//
// Incluye subida rápida inline para no tener que ir a /media.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Loader2, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  MEDIA_MAX_BYTES,
  uploadAccountMedia,
} from '@/lib/storage/upload-media';

export const MEDIA_PICKER_BUCKET = 'media';
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const ACCEPT_ATTR = ACCEPTED.join(',');

interface MediaItem {
  path: string;
  name: string;
  publicUrl: string;
}

interface MediaPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Se llama con la URL pública de la imagen elegida. */
  onSelect: (url: string) => void;
}

export function MediaPicker({ open, onOpenChange, onSelect }: MediaPickerProps) {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/media');
      const data = await res.json();
      if (res.ok) setItems(data.media ?? []);
    } catch {
      setItems([]);
    }
  }, []);

  // Recarga cada vez que se abre el modal (imágenes nuevas desde /media).
  useEffect(() => {
    if (open) {
      setItems(null);
      void load();
    }
  }, [open, load]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      toast.error('Solo JPG, PNG o WebP.');
      return;
    }
    if (file.size > MEDIA_MAX_BYTES) {
      toast.error('La imagen supera el límite de 16 MB.');
      return;
    }
    setUploading(true);
    try {
      const { publicUrl } = await uploadAccountMedia(MEDIA_PICKER_BUCKET, file);
      toast.success('Imagen subida.');
      onSelect(publicUrl);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo subir.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Elegir imagen del media</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-muted-foreground/30 px-3 py-2 text-sm text-muted-foreground hover:border-primary/50">
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UploadCloud className="h-4 w-4" />
            )}
            {uploading ? 'Subiendo...' : 'Subir una imagen nueva'}
            <input
              type="file"
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => {
                void upload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        <div className="grid max-h-[45vh] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
          {!items ? (
            <p className="col-span-full text-sm text-muted-foreground">Cargando media...</p>
          ) : items.length === 0 ? (
            <p className="col-span-full text-sm text-muted-foreground">
              No hay imágenes todavía. Sube la primera arriba.
            </p>
          ) : (
            items.map((item) => (
              <button
                key={item.path}
                onClick={() => {
                  onSelect(item.publicUrl);
                  onOpenChange(false);
                }}
                className="group overflow-hidden rounded-md border bg-muted/30 transition-colors hover:border-primary/60"
                title={item.name}
              >
                <div className="aspect-square w-full overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.publicUrl}
                    alt={item.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                </div>
              </button>
            ))
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}