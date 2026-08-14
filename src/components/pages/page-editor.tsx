'use client';

// PageEditor — edición de una landing page desde el JSON.
//
// Estructura:
//   SEO (title + description) → /api/pages/[slug] PUT
//   Bloques: lista reordenable (drag + ↑↓, duplicar, eliminar), cada bloque
//   se edita en un inspector con campos simples (dropdowns para enums),
//   selector de página de gracias y editor visual de tablas/filas.
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
  ImagePlus,
  Loader2,
  Save,
  Settings,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { BLOCK_TYPES, previewUrl } from '@/lib/landing-block-types';
import { ARRAY_EDITORS, ArrayBlockEditor } from './array-block-editor';
import { MediaPicker } from './media-picker';
import { LANDING_FORMS } from '@/lib/landing-settings';
import type { LandingSettings } from '@/lib/landing-settings';

interface LandingBlock {
  type: string;
  data: Record<string, unknown>;
}

interface LandingPage {
  slug: string;
  title: string;
  description: string;
  blocks: LandingBlock[];
  settings?: LandingSettings;
}

interface Props {
  slug: string;
}

// Etiquetas legibles de los campos escalares.
const FIELD_LABELS: Record<string, string> = {
  videoId: 'ID del video (YouTube)',
  desktopVideoId: 'ID horizontal (escritorio)',
  thumbMobile: 'Miniatura móvil (URL)',
  thumbDesktop: 'Miniatura escritorio (URL)',
  badge: 'Chapita (H1)',
  displayTitle: 'Titular',
  subtitle: 'Subtítulo',
  title: 'Título',
  text: 'Texto',
  heading: 'Título de sección',
  image: 'Imagen (URL)',
  id: 'ID (ancle)',
  formId: 'ID del formulario',
  sub: 'Subtítulo de captación',
  dark: 'Fondo oscuro',
  name: 'Nombre',
  meta: 'Meta (texto corto)',
  img: 'Imagen (URL)',
  href: 'Enlace (URL)',
  price: 'Precio',
  src: 'Imagen (URL)',
  alt: 'Texto alternativo',
  cover: 'Portada (URL)',
  cta: 'Texto del botón',
  heading2: 'Título',
  label: 'Etiqueta',
  icon: 'Icono (emoji)',
  jobTitle: 'Cargo',
  bio: 'Bio',
  downloadCta: 'Texto del botón de descarga',
  downloadName: 'Nombre del archivo',
  pdfHref: 'URL del PDF',
  waCta: 'Texto del botón de WhatsApp',
  backText: 'Texto del enlace de volver',
  backHref: 'Enlace de volver',
};

// Campos enum → se editan con dropdown, no con texto libre.
const ENUM_FIELDS: Record<string, { label: string; options: string[] }> = {
  ratio: { label: 'Ratio del video', options: ['auto', 'vertical', 'horizontal'] },
  videoPosition: { label: 'Posición del video', options: ['left', 'right'] },
  imagePosition: { label: 'Posición de la imagen', options: ['left', 'right'] },
  bg: { label: 'Fondo', options: ['white', 'secondary'] },
  speed: { label: 'Velocidad', options: ['fast', 'normal', 'slow'] },
  margin: { label: 'Margen', options: ['sm', 'md', 'lg'] },
};

// Campos booleanos → dropdown Sí/No.
const BOOLEAN_FIELDS = new Set(['dark']);

// Campos que guardan una URL de imagen → botón para elegir del media.
const IMAGE_FIELDS = new Set(['image', 'img', 'src', 'cover', 'thumbMobile', 'thumbDesktop']);

// Páginas de gracias disponibles para el campo `thankYou` (paths públicos).
// Las de agradecimiento existen por rewrite; el resto cuelga de /landing/.
const THANK_YOU_PATHS = ['/thank-you', '/thank-you-download'];

const selectCls =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

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
  const [newBlockType, setNewBlockType] = useState('');
  const [pageSlugs, setPageSlugs] = useState<string[]>([]);
  const [mediaField, setMediaField] = useState<string | null>(null);
  const [buildPending, setBuildPending] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

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

  // Lista de páginas para el selector de thank-you.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/pages');
        const data = await res.json();
        if (!cancelled && res.ok) {
          const slugs = (data.pages ?? [])
            .map((p: { slug: string }) => p.slug)
            .filter((s: string) => !['home', 'thank-you', 'thank-you-download'].includes(s));
          setPageSlugs(slugs);
        }
      } catch {
        // Sin lista no pasa nada: el select muestra solo los paths base.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
          settings: page.settings,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No se pudo guardar.');
        return;
      }
      setSaved(true);
      // Live update: el server recompila la landing en segundo plano.
      // Hacemos polling del estado del build y recargamos el preview al terminar.
      setBuildPending(true);
      setBuildError(null);
      pollBuild();
      setTimeout(() => setSaved(false), 4000);
    } catch {
      setError('No se pudo guardar la página.');
    } finally {
      setSaving(false);
    }
  };

  // Polling del build de la landing tras guardar (live update).
  const pollBuild = async () => {
    const deadline = Date.now() + 120_000; // máx. 2 min
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch('/api/pages/build-status');
        const data = await res.json();
        const st = data?.status;
        if (st === 'done') {
          setBuildPending(false);
          setPreviewKey((k) => k + 1); // HTML regenerado → recarga el preview
          return;
        }
        if (st === 'error') {
          setBuildPending(false);
          setBuildError(data?.status?.error ?? 'El build de la landing falló.');
          return;
        }
        if (Date.now() < deadline) {
          setTimeout(tick, 1500);
          return;
        }
        setBuildPending(false);
        setBuildError('El build tardó demasiado. Revisa la consola del servidor.');
      } catch {
        // Error de red transitorio: reintenta.
        if (Date.now() < deadline) {
          setTimeout(tick, 1500);
          return;
        }
        setBuildPending(false);
      }
    };
    void tick();
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
    const template = BLOCK_TYPES.find((b) => b.type === type);
    // El bloque nace con los campos del template (defaultData) para que el
    // inspector los muestre editables de inmediato.
    const data = template
      ? JSON.parse(JSON.stringify(template.defaultData))
      : {};
    const blocks = [...page.blocks, { type, data }];
    setPage({ ...page, blocks });
    setSelected(blocks.length - 1);
  };

  const updateField = (key: string, value: string | boolean | number) => {
    if (!page || selected === null) return;
    const blocks = page.blocks.map((b, i) =>
      i === selected ? { ...b, data: { ...b.data, [key]: value } } : b,
    );
    setPage({ ...page, blocks });
  };

  const updateArray = (data: Record<string, unknown>) => {
    if (!page || selected === null) return;
    const blocks = page.blocks.map((b, i) => (i === selected ? { ...b, data } : b));
    setPage({ ...page, blocks });
  };

  const updateSettings = (patch: Partial<LandingSettings>) => {
    if (!page) return;
    setPage({ ...page, settings: { ...(page.settings ?? {}), ...patch } });
  };

  if (!page) {
    return <p className="text-sm text-muted-foreground">Cargando página...</p>;
  }

  const selectedBlock = selected !== null ? page.blocks[selected] : null;
  const arrayConfig = selectedBlock ? ARRAY_EDITORS[selectedBlock.type] : null;
  const arrayKey = arrayConfig ? arrayConfig.arrayKey : null;

  // Campos escalares del bloque: excluye arrays (se editan en el editor de
  // tablas) y el campo thankYou (selector propio).
  const scalarFields = selectedBlock
    ? Object.entries(selectedBlock.data).filter(
        ([k, v]) => !Array.isArray(v) && k !== 'thankYou' && k !== arrayKey,
      )
    : [];

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
            <p className="text-xs text-muted-foreground">
              Editar: /pages/{page.slug} · Ver: {previewUrl(page.slug)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs text-emerald-600">
              Guardado ✓
            </span>
          )}
          {buildPending && (
            <span className="flex items-center gap-1.5 text-xs text-amber-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Regenerando HTML…
            </span>
          )}
          {!buildPending && !saved && buildError && (
            <span className="text-xs text-destructive" title={buildError}>
              Build falló
            </span>
          )}
          <Button
            variant="outline"
            onClick={() => setShowSettings((v) => !v)}
            className={showSettings ? 'border-primary text-primary' : ''}
          >
            <Settings className="mr-2 h-4 w-4" />
            Ajustes del sitio
          </Button>
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

      {/* Cómo funciona (el flujo editar → build) */}
      <Card className="bg-muted/30 p-4 text-xs text-muted-foreground">
        <p>
          <span className="font-semibold text-foreground">Cómo funciona:</span> al guardar se
          escribe el JSON de la landing (<code>landing/src/data/landings/{slug}.json</code>) y se
          regenera el HTML automáticamente (live update). El preview muestra el último build
          servido.
        </p>
      </Card>

      {/* Ajustes del sitio (overrides por landing) */}
      {showSettings && (
        <Card className="p-4">
          <h2 className="mb-1 text-sm font-semibold text-muted-foreground">Ajustes del sitio</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Deja vacío para usar el valor global. Afecta a WhatsApp, teléfono, botón principal,
            colores, menú y footer de esta landing.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="set-siteName">Nombre del negocio</Label>
              <Input
                id="set-siteName"
                value={page.settings?.siteName ?? ''}
                placeholder="Ej. Wacrm Estética"
                onChange={(e) => updateSettings({ siteName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-phone">Teléfono visible</Label>
              <Input
                id="set-phone"
                value={page.settings?.phone ?? ''}
                placeholder="Ej. +52 1 55 1234 5678"
                onChange={(e) => updateSettings({ phone: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-whatsapp">WhatsApp (número)</Label>
              <Input
                id="set-whatsapp"
                value={page.settings?.whatsappNumber ?? ''}
                placeholder="Ej. 5215512345678"
                onChange={(e) => updateSettings({ whatsappNumber: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-whatsappText">Mensaje de WhatsApp</Label>
              <Input
                id="set-whatsappText"
                value={page.settings?.whatsappText ?? ''}
                placeholder="Ej. Hola, quiero agendar mi valoración"
                onChange={(e) => updateSettings({ whatsappText: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-email">Email de contacto</Label>
              <Input
                id="set-email"
                value={page.settings?.email ?? ''}
                placeholder="Ej. hola@wacrm.mx"
                onChange={(e) => updateSettings({ email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-cta">Texto del botón principal (CTA)</Label>
              <Input
                id="set-cta"
                value={page.settings?.primaryCta ?? ''}
                placeholder="Ej. Agenda tu valoración"
                onChange={(e) => updateSettings({ primaryCta: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-color-primary">Color primario</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-9 w-9 cursor-pointer rounded border border-input"
                  value={page.settings?.colors?.primary ?? '#000000'}
                  onChange={(e) =>
                    updateSettings({
                      colors: { ...(page.settings?.colors ?? {}), primary: e.target.value },
                    })
                  }
                />
                <Input
                  id="set-color-primary"
                  value={page.settings?.colors?.primary ?? ''}
                  placeholder="#0f766e"
                  onChange={(e) =>
                    updateSettings({
                      colors: { ...(page.settings?.colors ?? {}), primary: e.target.value },
                    })
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-color-accent">Color de acento</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-9 w-9 cursor-pointer rounded border border-input"
                  value={page.settings?.colors?.accent ?? '#000000'}
                  onChange={(e) =>
                    updateSettings({
                      colors: { ...(page.settings?.colors ?? {}), accent: e.target.value },
                    })
                  }
                />
                <Input
                  id="set-color-accent"
                  value={page.settings?.colors?.accent ?? ''}
                  placeholder="#f59e0b"
                  onChange={(e) =>
                    updateSettings({
                      colors: { ...(page.settings?.colors ?? {}), accent: e.target.value },
                    })
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Links del menú (texto / enlace por línea)</Label>
              <Textarea
                value={(page.settings?.menuLinks ?? [])
                  .map((l) => `${l.text} | ${l.href}`)
                  .join('\n')}
                rows={4}
                placeholder={'Servicios | #servicios\nResultados | #galeria\nPrecios | #precios'}
                onChange={(e) =>
                  updateSettings({
                    menuLinks: e.target.value
                      .split('\n')
                      .map((line) => line.trim())
                      .filter(Boolean)
                      .map((line) => {
                        const [text, ...rest] = line.split('|').map((s) => s.trim());
                        return { text: text ?? '', href: rest.join('|').trim() || '#' };
                      }),
                  })
                }
              />
              <p className="text-[11px] text-muted-foreground">
                Formato por línea: <code>texto | #enlace</code>. Vacío = menú global.
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Guarda los cambios para aplicarlos.
          </p>
        </Card>
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
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Lista de bloques */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Secciones de la página</h2>
          {page.blocks.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sin secciones. Añade la primera con el selector de abajo.
            </p>
          )}
          {page.blocks.map((block, i) => {
            const meta = BLOCK_TYPES.find((b) => b.type === block.type);
            const isDragging = dragIndex === i;
            const isOver = overIndex === i && dragIndex !== null && dragIndex !== i;
            return (
              <Card
                key={`${block.type}-${i}`}
                size="sm"
                draggable
                onDragStart={handleDragStart(i)}
                onDragOver={handleDragOver(i)}
                onDrop={handleDrop(i)}
                onDragEnd={handleDragEnd}
                // flex-row anula el flex-col base del Card (tailwind-merge):
                // sin esto cada bloque se apila verticalmente y queda enorme.
                className={`flex flex-row items-center gap-2 p-3 ${
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
          <div className="flex items-center gap-2 pt-2">
            <select
              aria-label="Tipo de bloque"
              className={selectCls}
              value={newBlockType}
              onChange={(e) => {
                if (e.target.value) {
                  addBlock(e.target.value);
                  setNewBlockType('');
                }
              }}
            >
              <option value="" disabled>
                Añadir sección…
              </option>
              {BLOCK_TYPES.map((bt) => (
                <option key={bt.type} value={bt.type}>
                  {bt.icon} {bt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Inspector */}
        {selectedBlock && selected !== null && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {BLOCK_TYPES.find((b) => b.type === selectedBlock.type)?.label ?? selectedBlock.type}
            </h2>

            {/* Campos escalares */}
            {scalarFields.length > 0 && (
              <div className="space-y-3">
                {scalarFields.map(([key, value]) => {
                  const enumDef = ENUM_FIELDS[key];
                  const label = FIELD_LABELS[key] ?? key;
                  if (enumDef) {
                    return (
                      <div key={key} className="space-y-1.5">
                        <Label htmlFor={`f-${key}`}>{enumDef.label}</Label>
                        <select
                          id={`f-${key}`}
                          className={selectCls}
                          value={String(value)}
                          onChange={(e) => updateField(key, e.target.value)}
                        >
                          {enumDef.options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  }
                  if (BOOLEAN_FIELDS.has(key)) {
                    return (
                      <div key={key} className="space-y-1.5">
                        <Label htmlFor={`f-${key}`}>{label}</Label>
                        <select
                          id={`f-${key}`}
                          className={selectCls}
                          value={value === true ? 'true' : 'false'}
                          onChange={(e) => updateField(key, e.target.value === 'true')}
                        >
                          <option value="true">Sí</option>
                          <option value="false">No</option>
                        </select>
                      </div>
                    );
                  }
                  if (key === 'thankYou') {
                    const options = [
                      ...THANK_YOU_PATHS,
                      ...pageSlugs.map((s) => `/landing/${s}`),
                    ];
                    const current = String(value ?? '');
                    if (current && !options.includes(current)) options.unshift(current);
                    return (
                      <div key={key} className="space-y-1.5">
                        <Label htmlFor="f-thankYou">Página de gracias</Label>
                        <select
                          id="f-thankYou"
                          className={selectCls}
                          value={current}
                          onChange={(e) => updateField('thankYou', e.target.value)}
                        >
                          {options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  }
                  if (key === 'formId') {
                    const current = String(value ?? 'contact');
                    const options = [...LANDING_FORMS];
                    if (current && !options.some((o) => o.id === current)) {
                      options.unshift({ id: current, label: `${current} (personalizado)` });
                    }
                    return (
                      <div key={key} className="space-y-1.5">
                        <Label htmlFor="f-formId">Formulario de captación</Label>
                        <select
                          id="f-formId"
                          className={selectCls}
                          value={current}
                          onChange={(e) => updateField('formId', e.target.value)}
                        >
                          {options.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  }
                  return (
                    <div key={key} className="space-y-1.5">
                      <Label htmlFor={`f-${key}`}>{label}</Label>
                      {typeof value === 'string' && value.length > 80 ? (
                        <Textarea
                          id={`f-${key}`}
                          rows={3}
                          value={value}
                          onChange={(e) => updateField(key, e.target.value)}
                        />
                      ) : IMAGE_FIELDS.has(key) ? (
                        <div className="flex gap-2">
                          <Input
                            id={`f-${key}`}
                            value={String(value)}
                            placeholder="URL de la imagen"
                            onChange={(e) => updateField(key, e.target.value)}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            title="Elegir del media"
                            onClick={() => setMediaField(key)}
                          >
                            <ImagePlus className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Input
                          id={`f-${key}`}
                          value={String(value)}
                          onChange={(e) => updateField(key, e.target.value)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Tablas / listas de ítems */}
            {arrayConfig && (
              <div className="space-y-2">
                <Label className="text-xs">Contenido de {FIELD_LABELS[arrayConfig.arrayKey] ?? arrayConfig.arrayKey}</Label>
                <ArrayBlockEditor
                  type={selectedBlock.type}
                  data={selectedBlock.data}
                  onChange={updateArray}
                />
              </div>
            )}

            {scalarFields.length === 0 && !arrayConfig && (
              <p className="text-xs text-muted-foreground">
                Este bloque no tiene campos editables.
              </p>
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

      {/* Picker de media para campos de imagen */}
      <MediaPicker
        open={mediaField !== null}
        onOpenChange={(open) => !open && setMediaField(null)}
        onSelect={(url) => {
          if (mediaField) updateField(mediaField, url);
          setMediaField(null);
        }}
      />
    </div>
  );
}
