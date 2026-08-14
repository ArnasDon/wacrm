'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Plus, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRouter } from 'next/navigation';
import { previewUrl } from '@/lib/landing-block-types';

interface PageItem {
  slug: string;
  title: string;
}

export function PagesList() {
  const router = useRouter();
  const [pages, setPages] = useState<PageItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newSlug, setNewSlug] = useState('');
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/pages');
        const data = await res.json();
        if (!cancelled) setPages(data.pages ?? []);
      } catch {
        if (!cancelled) setError('No se pudo cargar la lista de páginas.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const createPage = async () => {
    const slug = newSlug.trim().toLowerCase();
    if (!slug) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, title: newTitle.trim() || slug }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo crear la página.');
        return;
      }
      router.push(`/pages/${slug}`);
    } catch {
      setError('No se pudo crear la página.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Landing pages</h1>
          <p className="text-sm text-muted-foreground">
            Páginas de la landing editables. Cambios visibles tras rebuild del landing.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Crear nueva página */}
      <Card className="p-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_1.5fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="new-slug">Slug (URL)</Label>
            <Input
              id="new-slug"
              placeholder="fisioterapia-deportiva"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Minúsculas, números y guiones.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-title">Título</Label>
            <Input
              id="new-title"
              placeholder="Fisioterapia deportiva en CDMX"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createPage()}
            />
          </div>
          <Button onClick={createPage} disabled={creating || !newSlug.trim()}>
            <Plus className="mr-2 h-4 w-4" />
            {creating ? 'Creando...' : 'Crear página'}
          </Button>
        </div>
      </Card>

      {/* Lista de páginas */}
      {!pages ? (
        <p className="text-sm text-muted-foreground">Cargando páginas...</p>
      ) : pages.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay páginas. Crea la primera arriba.</p>
      ) : (
        <div className="space-y-2">
          {pages.map((p) => (
            <Card
              key={p.slug}
              className="flex flex-row items-center justify-between p-4 transition-colors"
            >
              <Link href={`/pages/${p.slug}`} className="flex flex-1 items-center gap-3">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">{p.title || p.slug}</p>
                  <p className="text-xs text-muted-foreground">
                    Editar: /pages/{p.slug} · Ver: {previewUrl(p.slug)}
                  </p>
                </div>
              </Link>
              <a href={previewUrl(p.slug)} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
              </a>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}