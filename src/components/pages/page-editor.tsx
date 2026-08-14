'use client';

// PageEditor — edición de una landing page desde el JSON.
//
// Estructura:
//   SEO (title + description) → /api/pages/[slug] PUT
//   Bloques: lista reordenable (↑↓), cada bloque se edita en un inspector.
//
// El JSON que se guarda es EXACTAMENTE el que consume la Content Collection
// de Astro: el editor no inventa estructura, la valida el schema zod en el
// build de la landing.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  Copy,
  ExternalLink,
  Eye,
  GripVertical,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { BLOCK_TYPES } from '@/lib/landing-block-types';

interface LandingBlock {
  type: string;
  data: Record<string, unknown>;
}

interface LandingPage {
  slug: string;
  title: string;
  description: string;
  blocks: LandingBlock[];
}

interface Props {
  slug: string;
}

// Campos conocidos por tipo de bloque. Los valores se editan como texto
// plano (los anidados como JSON en el inspector avanzado).
const FIELD_LABELS: Record<string, string> = {
  videoId: 'ID del video (YouTube)',
  desktopVideoId: 'ID horizontal (escritorio)',
  badge: 'Chapita (H1)',
  displayTitle: 'Titular',
  subtitle: 'Subtítulo',
  title: 'Título',
  text: 'Texto',
  heading: 'Título de sección',
  image: 'Imagen (URL)',
  imagePosition: 'Posición de imagen (left|right)',
  bg: 'Fondo (white|secondary)',
  ratio: 'Ratio (auto|vertical|horizontal)',
  videoPosition: 'Posición de video (left|right)',
  id: 'ID (ancle)',
  formId: 'ID del formulario',
  sub: 'Subtítulo de captación',
  dark: 'Oscuro (true|false)',
  name: 'Nombre',
  meta: 'Meta (texto corto)',
  img: 'Imagen (URL)',
  href: 'Enlace (URL)',
  price: 'Precio',
  src: 'Imagen (URL)',
  alt: 'Texto alternativo',
  cover: 'Portada (URL)',
  cta: 'Texto del botón',
  thankYou: 'Página de gracias',
  heading2: 'Título',
  label: 'Etiqueta',
  icon: 'Icono (emoji)',
};

// Bloques cuyo `data` es una lista de ítems (arrays de objetos) → se editan
// como JSON en el inspector (editor avanzado).
const ARRAY_BLOCK_TYPES = new Set([
  'social-proof',
  'scroller-cards',
  'features',
  'pricing-table',
  'comparison',
  'data-table',
  'video-testimonials',
  'reviews',
  'team',
  'how-it-works',
  'faq',
  'related-pages',
]);

// URL del preview de una landing.
// - Por defecto apunta al estático servido por el propio Next: /landing/ para
//   home y /landing/<slug>.html para el resto (así lo deja el build de Astro
//   copiado a public/landing).
// - Si hay NEXT_PUBLIC_LANDING_URL (ej: http://localhost:4321/landing con el
//   dev server de Astro), se usa esa base y los slugs no llevan extensión.
function previewUrl(slug: string): string {
  const devServerUrl = process.env.NEXT_PUBLIC_LANDING_URL;
  const base = (devServerUrl || '/landing').replace(/\/+$/, '');
  const devServer = typeof devServerUrl === 'string' && devServerUrl.length > 0;
  if (slug === 'home') return `${base}/`;
  return `${base}/${slug}${devServer ? '' : '.html'}`;
}

export function PageEditor({ slug }: Props) {
  const router = useRouter();
  const [page, setPage] = useState<LandingPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/pages/${slug}`);
        const data = await res.json();
        if (!cancelled) {
          if (res.ok) setPage(data.page);
          else setError(data.error ?? 'No se pudo cargar la página.');
        }
      } catch {
        if (!cancelled) setError('No se pudo cargar la página.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const save = async () => {
    if (!page) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/pages/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: page.title,
          description: page.description,
          blocks: page.blocks,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo guardar.');
        return;
      }
      setSaved(true);
      setPreviewKey((k) => k + 1); // recarga el preview con el contenido guardado
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError('No se pudo guardar la página.');
    } finally {
      setSaving(false);
    }
  };

  const move = (index: number, dir: -1 | 1) => {
    if (!page) return;
    const target = index + dir;
    if (target < 0 || target >= page.blocks.length) return;
    const blocks = [...page.blocks];
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    setPage({ ...page, blocks });
    setSelected(target);
  };

  const removeBlock = (index: number) => {
    if (!page) return;
    const blocks = page.blocks.filter((_, i) => i !== index);
    setPage({ ...page, blocks });
    setSelected(null);
  };

  const duplicateBlock = (index: number) => {
    if (!page) return;
    const blocks = [...page.blocks];
    blocks.splice(index + 1, 0, {
      ...blocks[index],
      // copia profunda para no compartir referencia con el original
      data: JSON.parse(JSON.stringify(blocks[index].data)),
    });
    setPage({ ...page, blocks });
    setSelected(index + 1);
  };

  // Drag-and-drop nativo (HTML5) para reordenar bloques.
  const handleDragStart = (index: number) => (e: React.DragEvent) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overIndex !== index) setOverIndex(index);
  };

  const handleDrop = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index || !page) return;
    const blocks = [...page.blocks];
    const [moved] = blocks.splice(dragIndex, 1);
    blocks.splice(index, 0, moved);
    setPage({ ...page, blocks });
    setSelected(index);
    setDragIndex(null);
    setOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const addBlock = (type: string) => {
    if (!page) return;
    const blocks = [...page.blocks, { type, data: {} }];
    setPage({ ...page, blocks });
    setSelected(blocks.length - 1);
  };

  const updateField = (key: string, value: string) => {
    if (!page || selected === null) return;
    const blocks = page.blocks.map((b, i) =>
      i === selected ? { ...b, data: { ...b.data, [key]: value } } : b,
    );
    setPage({ ...page, blocks });
  };

  if (!page) {
    return <p className="text-sm text-muted-foreground">Cargando página...</p>;
  }

  const selectedBlock = selected !== null ? page.blocks[selected] : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => router.push('/pages')}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{page.title || page.slug}</h1>
            <p className="text-xs text-muted-foreground">/{page.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-emerald-600">Guardado ✓</span>}
          <Button variant="outline" onClick={() => setShowPreview((v) => !v)}>
            <Eye className="mr-2 h-4 w-4" />
            {showPreview ? 'Ocultar preview' : 'Vista previa'}
          </Button>
          <a href={previewUrl(slug)} target="_blank" rel="noreferrer">
            <Button variant="outline" type="button">
              <ExternalLink className="mr-2 h-4 w-4" />
              Abrir
            </Button>
          </a>
          <Button onClick={save} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* SEO */}
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">SEO</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="seo-title">SEO title</Label>
            <Input
              id="seo-title"
              value={page.title}
              onChange={(e) => setPage({ ...page, title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seo-description">Meta description</Label>
            <Textarea
              id="seo-description"
              value={page.description}
              onChange={(e) => setPage({ ...page, description: e.target.value })}
              rows={2}
            />
          </div>
        </div>
      </Card>

      {/* Bloques */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Lista de bloques */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Secciones de la página</h2>
          {page.blocks.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sin secciones. Añade la primera con el botón de abajo.
            </p>
          )}
          {page.blocks.map((block, i) => {
            const meta = BLOCK_TYPES.find((b) => b.type === block.type);
            const isDragging = dragIndex === i;
            const isOver = overIndex === i && dragIndex !== null && dragIndex !== i;
            return (
              <Card
                key={`${block.type}-${i}`}
                draggable
                onDragStart={handleDragStart(i)}
                onDragOver={handleDragOver(i)}
                onDrop={handleDrop(i)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-2 p-3 transition-colors ${
                  selected === i ? 'border-primary ring-1 ring-primary' : ''
                } ${isDragging ? 'opacity-50' : ''} ${
                  isOver ? 'border-dashed border-primary/60 ring-1 ring-primary/30' : ''
                } ${dragIndex !== null ? 'cursor-grabbing' : 'cursor-grab'}`}
              >
                <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />
                <button
                  type="button"
                  className="flex flex-1 items-center gap-2 text-left"
                  onClick={() => setSelected(selected === i ? null : i)}
                >
                  <span aria-hidden>{meta?.icon ?? '🔧'}</span>
                  <div>
                    <p className="text-sm font-medium">{meta?.label ?? block.type}</p>
                    <p className="text-xs text-muted-foreground">#{i + 1}</p>
                  </div>
                </button>
                <Button variant="ghost" size="icon" onClick={() => duplicateBlock(i)} title="Duplicar">
                  <Copy className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={i === page.blocks.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => removeBlock(i)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </Card>
            );
          })}

          {/* Añadir bloque */}
          <div className="flex flex-wrap gap-2 pt-2">
            {BLOCK_TYPES.map((bt) => (
              <Button key={bt.type} variant="outline" size="sm" onClick={() => addBlock(bt.type)}>
                <Plus className="mr-1 h-3 w-3" />
                {bt.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Inspector */}
        {selectedBlock && selected !== null && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {BLOCK_TYPES.find((b) => b.type === selectedBlock.type)?.label ?? selectedBlock.type}
            </h2>

            {ARRAY_BLOCK_TYPES.has(selectedBlock.type) ? (
              <div className="space-y-1.5">
                <Label>Contenido (JSON)</Label>
                <Textarea
                  rows={14}
                  className="font-mono text-xs"
                  value={JSON.stringify(selectedBlock.data, null, 2)}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value);
                      const blocks = page.blocks.map((b, i) =>
                        i === selected ? { ...b, data: parsed } : b,
                      );
                      setPage({ ...page, blocks });
                    } catch {
                      // JSON inválido mientras se escribe: no se rompe el estado.
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Edición avanzada: estructura JSON validada por el build de Astro.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(selectedBlock.data).map(([key, value]) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`f-${key}`}>{FIELD_LABELS[key] ?? key}</Label>
                    {typeof value === 'string' && value.length > 80 ? (
                      <Textarea
                        id={`f-${key}`}
                        rows={3}
                        value={value}
                        onChange={(e) => updateField(key, e.target.value)}
                      />
                    ) : (
                      <Input
                        id={`f-${key}`}
                        value={String(value)}
                        onChange={(e) => updateField(key, e.target.value)}
                      />
                    )}
                  </div>
                ))}
                {Object.keys(selectedBlock.data).length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Sin campos todavía. Guarda y edita los valores en el inspector
                    (los campos se autogeneran desde el JSON guardado).
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Preview embebido */}
      {showPreview && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <h2 className="text-sm font-semibold text-muted-foreground">Vista previa</h2>
            <a href={previewUrl(slug)} target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm" type="button">
                <ExternalLink className="mr-1 h-3 w-3" />
                Abrir en pestaña nueva
              </Button>
            </a>
          </div>
          <iframe
            key={previewKey}
            src={previewUrl(slug)}
            title={`Preview de ${slug}`}
            className="h-[70vh] w-full border-0 bg-white"
          />
          <p className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            El HTML estático se regenera en el build de la landing. El preview se recarga al
            guardar: muestra el último build servido. En desarrollo (astro dev con
            NEXT_PUBLIC_LANDING_URL) se actualiza al instante.
          </p>
        </Card>
      )}
    </div>
  );
}