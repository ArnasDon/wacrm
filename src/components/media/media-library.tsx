'use client';

// ============================================================
// MediaLibrary — viewer + uploader para el bucket `media`.
//
//   · Subir: drag & drop o clic (JPEG / PNG / WebP, ≤16 MB).
//   · Ver: grid de miniaturas → lightbox con nombre, tamaño y fecha.
//   · Bajar: enlace directo a la URL pública (download).
//   · Copiar URL: lista para pegar en un campo de imagen del editor.
//   · Eliminar: borra el objeto del bucket (RLS account-scoped).
//
// La subida usa el helper compartido uploadAccountMedia (misma
// convención de paths account-<id>/… que chat-media / flow-media),
// nunca paths escritos a mano.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, ImageOff, Link2, Loader2, Trash2, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import {
  MEDIA_MAX_BYTES,
  uploadAccountMedia,
} from '@/lib/storage/upload-media';

export const MEDIA_BUCKET = 'media';
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const ACCEPT_ATTR = ACCEPTED.join(',');

interface MediaItem {
  path: string;
  name: string;
  publicUrl: string;
  size: number;
  updatedAt: string | null;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Extrae el nombre de archivo original del path (la última parte). */
function nameFromPath(path: string): string {
  return path.split('/').pop() ?? path;
}

export function MediaLibrary() {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/media');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error');
      setItems(data.media ?? []);
      setError(null);
    } catch {
      setError('No se pudo cargar el media.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    const invalid = list.find((f) => !ACCEPTED.includes(f.type));
    if (invalid) {
      toast.error(`Formato no soportado: ${invalid.name}. Solo JPG, PNG o WebP.`);
      return;
    }
    const tooBig = list.find((f) => f.size > MEDIA_MAX_BYTES);
    if (tooBig) {
      toast.error(`${tooBig.name} supera el límite de ${formatBytes(MEDIA_MAX_BYTES)}.`);
      return;
    }

    setUploading(true);
    try {
      for (const file of list) {
        const { publicUrl } = await uploadAccountMedia(MEDIA_BUCKET, file);
        toast.success(`${file.name} subida.`);
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo subir la imagen.');
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void upload(e.dataTransfer.files);
  };

  const remove = async () => {
    if (!selected) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/media', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selected.path }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error');
      toast.success('Imagen eliminada.');
      setSelected(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo eliminar.');
    } finally {
      setDeleting(false);
    }
  };

  const copyUrl = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('No se pudo copiar la URL.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Media</h1>
          <p className="text-sm text-muted-foreground">
            Imágenes para tus páginas y broadcasts. JPG, PNG o WebP.
          </p>
        </div>
        <Button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          variant="outline"
        >
          {uploading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <UploadCloud className="mr-2 h-4 w-4" />
          )}
          {uploading ? 'Subiendo...' : 'Subir imágenes'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Zona drag & drop */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50'
        }`}
      >
        <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-2 text-sm font-medium">
          {dragging ? 'Suelta las imágenes aquí' : 'Arrastra imágenes aquí o haz clic'}
        </p>
        <p className="text-xs text-muted-foreground">JPG · PNG · WebP — máx. 16 MB</p>
      </div>

      {/* Grid */}
      {!items ? (
        <p className="text-sm text-muted-foreground">Cargando media...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay imágenes. Sube la primera arriba.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((item) => (
            <button
              key={item.path}
              onClick={() => setSelected(item)}
              className="group overflow-hidden rounded-lg border bg-muted/30 text-left transition-colors hover:border-primary/50"
            >
              <div className="relative aspect-square w-full overflow-hidden">
                {/* Miniatura directa: URLs públicas del bucket, sin
                    optimization de Next (evita config de remotePatterns). */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.publicUrl}
                  alt={item.name}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              </div>
              <p className="truncate px-2 py-1.5 text-xs text-muted-foreground">
                {nameFromPath(item.name)}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Lightbox */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-8">
              {selected ? nameFromPath(selected.name) : ''}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="flex max-h-[50vh] items-center justify-center overflow-hidden rounded-lg bg-muted/40">
                {selected.publicUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selected.publicUrl}
                    alt={selected.name}
                    className="max-h-[50vh] w-auto object-contain"
                  />
                ) : (
                  <ImageOff className="h-10 w-10 text-muted-foreground" />
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{formatBytes(selected.size)}</span>
                <span>{formatDate(selected.updatedAt)}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={selected.publicUrl} download={nameFromPath(selected.name)}>
                  <Button variant="outline" size="sm">
                    <Download className="mr-2 h-4 w-4" />
                    Descargar
                  </Button>
                </a>
                <Button variant="outline" size="sm" onClick={copyUrl}>
                  <Link2 className="mr-2 h-4 w-4" />
                  {copied ? '¡Copiada!' : 'Copiar URL'}
                </Button>
                <div className="flex-1" />
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (window.confirm('¿Eliminar esta imagen? No se puede deshacer.')) {
                      void remove();
                    }
                  }}
                  disabled={deleting}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {deleting ? 'Eliminando...' : 'Eliminar'}
                </Button>
              </div>
              {/* URL completa, seleccionable */}
              <p className="break-all rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {selected.publicUrl}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
