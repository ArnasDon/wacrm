'use client';

// ArrayBlockEditor — edición visual de bloques cuyo `data` es una lista de
// ítems (tablas, faq, reviews, precios…). Reemplaza el textarea JSON crudo:
// cada fila se edita con campos, se pueden añadir/eliminar/mover filas.
//
// La estructura que se guarda sigue siendo la del schema de Astro
// (content.config.ts): el editor solo facilita llenarla, no la inventa.

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'lines';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
}

export type BlockEditorConfig =
  | { kind: 'objects'; arrayKey: string; fields: FieldDef[]; itemLabel?: (i: number) => string }
  | { kind: 'strings'; arrayKey: string; placeholder?: string };

// Definición de los ítems de cada bloque (campos del schema zod de Astro).
export const ARRAY_EDITORS: Record<string, BlockEditorConfig> = {
  // data-table se edita con su editor propio (DataTableEditor, que maneja
  // head + rows); esta entrada solo hace que el inspector lo renderice.
  'data-table': { kind: 'strings', arrayKey: 'head' },
  'social-proof': {
    kind: 'objects',
    arrayKey: 'stats',
    itemLabel: (i) => `Cifra ${i + 1}`,
    fields: [
      { key: 'num', label: 'Número', type: 'text' },
      { key: 'label', label: 'Etiqueta', type: 'text' },
    ],
  },
  scroller: { kind: 'strings', arrayKey: 'items', placeholder: 'Texto (logo o palabra)' },
  'scroller-cards': {
    kind: 'objects',
    arrayKey: 'cards',
    itemLabel: (i) => `Tarjeta ${i + 1}`,
    fields: [
      { key: 'name', label: 'Nombre', type: 'text' },
      { key: 'meta', label: 'Meta', type: 'text' },
      { key: 'img', label: 'Imagen (URL)', type: 'text' },
      { key: 'href', label: 'Enlace', type: 'text' },
    ],
  },
  features: {
    kind: 'objects',
    arrayKey: 'features',
    itemLabel: (i) => `Beneficio ${i + 1}`,
    fields: [
      { key: 'icon', label: 'Icono (emoji)', type: 'text' },
      { key: 'title', label: 'Título', type: 'text' },
      { key: 'text', label: 'Texto', type: 'textarea' },
    ],
  },
  specialties: {
    kind: 'objects',
    arrayKey: 'services',
    itemLabel: (i) => `Tratamiento ${i + 1}`,
    fields: [
      { key: 'name', label: 'Nombre', type: 'text' },
      { key: 'desc', label: 'Descripción', type: 'textarea' },
      { key: 'price', label: 'Precio', type: 'text' },
    ],
  },
  'pricing-table': {
    kind: 'objects',
    arrayKey: 'rows',
    itemLabel: (i) => `Fila ${i + 1}`,
    fields: [
      { key: 'name', label: 'Nombre', type: 'text' },
      { key: 'price', label: 'Precio', type: 'text' },
      { key: 'category', label: '¿Es categoría?', type: 'boolean' },
    ],
  },
  comparison: {
    kind: 'objects',
    arrayKey: 'cols',
    itemLabel: (i) => `Columna ${i + 1}`,
    fields: [
      { key: 'head', label: 'Encabezado', type: 'text' },
      { key: 'good', label: '¿Es la opción buena?', type: 'boolean' },
      { key: 'items', label: 'Elementos (uno por línea)', type: 'lines' },
    ],
  },
  'video-testimonials': {
    kind: 'objects',
    arrayKey: 'items',
    itemLabel: (i) => `Testimonio ${i + 1}`,
    fields: [
      { key: 'id', label: 'ID del video (YouTube)', type: 'text' },
      { key: 'name', label: 'Nombre', type: 'text' },
      { key: 'quote', label: 'Cita', type: 'textarea' },
    ],
  },
  reviews: {
    kind: 'objects',
    arrayKey: 'reviews',
    itemLabel: (i) => `Reseña ${i + 1}`,
    fields: [
      { key: 'name', label: 'Nombre', type: 'text' },
      { key: 'text', label: 'Texto', type: 'textarea' },
      { key: 'rating', label: 'Rating (1-5)', type: 'number' },
    ],
  },
  gallery: { kind: 'strings', arrayKey: 'images', placeholder: 'URL de la imagen' },
  'how-it-works': {
    kind: 'objects',
    arrayKey: 'steps',
    itemLabel: (i) => `Paso ${i + 1}`,
    fields: [
      { key: 'title', label: 'Título', type: 'text' },
      { key: 'text', label: 'Texto', type: 'textarea' },
    ],
  },
  team: {
    kind: 'objects',
    arrayKey: 'team',
    itemLabel: (i) => `Miembro ${i + 1}`,
    fields: [
      { key: 'name', label: 'Nombre', type: 'text' },
      { key: 'role', label: 'Rol', type: 'text' },
      { key: 'bio', label: 'Bio', type: 'textarea' },
      { key: 'img', label: 'Imagen (URL)', type: 'text' },
    ],
  },
  faq: {
    kind: 'objects',
    arrayKey: 'faq',
    itemLabel: (i) => `Pregunta ${i + 1}`,
    fields: [
      { key: 'q', label: 'Pregunta', type: 'text' },
      { key: 'a', label: 'Respuesta', type: 'textarea' },
    ],
  },
  'related-pages': {
    kind: 'objects',
    arrayKey: 'pages',
    itemLabel: (i) => `Página ${i + 1}`,
    fields: [
      { key: 'title', label: 'Título', type: 'text' },
      { key: 'text', label: 'Texto', type: 'textarea' },
      { key: 'href', label: 'Enlace', type: 'text' },
    ],
  },
};

// ── helpers de parseo ───────────────────────────────────────────

function toLines(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join('\n');
  return value ? String(value) : '';
}

function fromLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

const selectCls =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

// ── campo individual dentro de una fila ─────────────────────────

function RowField({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: string | number | boolean) => void;
}) {
  const str = Array.isArray(value)
    ? value.join('\n')
    : value === undefined || value === null
      ? ''
      : String(value);
  switch (field.type) {
    case 'boolean':
      return (
        <select
          className={selectCls}
          value={value === true ? 'true' : 'false'}
          onChange={(e) => onChange(e.target.value === 'true')}
        >
          <option value="true">Sí</option>
          <option value="false">No</option>
        </select>
      );
    case 'number':
      return (
        <Input
          type="number"
          value={str}
          onChange={(e) => onChange(Number(e.target.value))}
          placeholder={field.label}
        />
      );
    case 'textarea':
    case 'lines':
      return (
        <Textarea
          rows={2}
          value={str}
          placeholder={field.label}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <Input value={str} placeholder={field.label} onChange={(e) => onChange(e.target.value)} />
      );
  }
}

// ── editor de filas (objetos) ───────────────────────────────────

function ObjectsEditor({
  config,
  items,
  setItems,
}: {
  config: Extract<BlockEditorConfig, { kind: 'objects' }>;
  items: Record<string, unknown>[];
  setItems: (items: unknown[]) => void;
}) {
  const newItem = () => Object.fromEntries(config.fields.map((f) => [f.key, '']));
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <Card key={i} size="sm" className="space-y-2 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground">
              {config.itemLabel ? config.itemLabel(i) : `Item ${i + 1}`}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={i === 0}
                onClick={() => {
                  const next = [...items];
                  [next[i], next[i - 1]] = [next[i - 1], next[i]];
                  setItems(next);
                }}
              >
                <ArrowUp className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={i === items.length - 1}
                onClick={() => {
                  const next = [...items];
                  [next[i], next[i + 1]] = [next[i + 1], next[i]];
                  setItems(next);
                }}
              >
                <ArrowDown className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setItems(items.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          </div>
          {config.fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs">{f.label}</Label>
              {f.type === 'lines' ? (
                <RowField
                  field={f}
                  value={Array.isArray(item[f.key]) ? item[f.key] : ''}
                  onChange={(v) => {
                    const next = items.map((it, j) =>
                      j === i
                        ? { ...it, [f.key]: typeof v === 'string' ? fromLines(v) : v }
                        : it,
                    );
                    setItems(next);
                  }}
                />
              ) : (
                <RowField
                  field={f}
                  value={item[f.key]}
                  onChange={(v) => {
                    const next = items.map((it, j) => (j === i ? { ...it, [f.key]: v } : it));
                    setItems(next);
                  }}
                />
              )}
            </div>
          ))}
        </Card>
      ))}
      <Button variant="outline" size="sm" type="button" onClick={() => setItems([...items, newItem()])}>
        <Plus className="mr-1 h-3 w-3" />
        Añadir {config.itemLabel ? config.itemLabel(items.length).toLowerCase() : 'fila'}
      </Button>
    </div>
  );
}

// ── editor de listas de strings (scroller, gallery…) ────────────

function StringsEditor({
  config,
  items,
  setItems,
}: {
  config: Extract<BlockEditorConfig, { kind: 'strings' }>;
  items: string[];
  setItems: (items: unknown[]) => void;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={item}
            placeholder={config.placeholder ?? 'Texto'}
            onChange={(e) =>
              setItems(items.map((it, j) => (j === i ? e.target.value : it)))
            }
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setItems(items.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" type="button" onClick={() => setItems([...items, ''])}>
        <Plus className="mr-1 h-3 w-3" />
        Añadir
      </Button>
    </div>
  );
}

// ── data-table (matriz): encabezados + filas separadas por | ─────

function DataTableEditor({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}) {
  const head = Array.isArray(data.head) ? data.head.map(String) : [];
  const rows = Array.isArray(data.rows) ? data.rows.map((r) => (Array.isArray(r) ? r.map(String) : [])) : [];
  const rowsText = rows.map((r) => r.join(' | ')).join('\n');

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Encabezados (uno por línea)</Label>
        <Textarea
          rows={3}
          value={head.join('\n')}
          onChange={(e) => onChange({ ...data, head: fromLines(e.target.value) })}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Filas (una por línea, celdas separadas por | )</Label>
        <Textarea
          rows={8}
          className="font-mono text-xs"
          value={rowsText}
          onChange={(e) =>
            onChange({
              ...data,
              rows: e.target.value
                .split('\n')
                .map((l) => l.split('|').map((c) => c.trim()))
                .filter((r) => r.length > 1 || (r.length === 1 && r[0] !== '')),
            })
          }
        />
        <p className="text-xs text-muted-foreground">
          Ej: <code>Consulta inicial | $900 | 45 min</code>
        </p>
      </div>
    </div>
  );
}

// ── componente principal ────────────────────────────────────────

export function ArrayBlockEditor({
  type,
  data,
  onChange,
}: {
  type: string;
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}) {
  if (type === 'data-table') return <DataTableEditor data={data} onChange={onChange} />;

  const config = ARRAY_EDITORS[type];
  if (!config) return null;

  const rawItems = Array.isArray(data[config.arrayKey]) ? data[config.arrayKey] : [];
  const setItems = (items: unknown[]) => onChange({ ...data, [config.arrayKey]: items });

  return config.kind === 'objects' ? (
    <ObjectsEditor
      config={config}
      items={rawItems as Record<string, unknown>[]}
      setItems={setItems}
    />
  ) : (
    <StringsEditor
      config={config}
      items={(rawItems as unknown[]).map(String)}
      setItems={setItems}
    />
  );
}
