'use client';

import { useTranslations } from 'next-intl';
import type { FiltroAsesor as Filtro } from '@/modulos/visibilidad/visibilidad';

function aValor(f: Filtro): string {
  if (f.tipo === 'asesor') return `asesor:${f.asesorId}`;
  return f.tipo;
}

function deValor(v: string): Filtro {
  if (v === 'sin-asignar') return { tipo: 'sin-asignar' };
  if (v.startsWith('asesor:')) {
    return { tipo: 'asesor', asesorId: v.slice('asesor:'.length) };
  }
  return { tipo: 'todos' };
}

export function FiltroAsesor({
  valor,
  asesores,
  onCambio,
}: {
  valor: Filtro;
  asesores: { userId: string; nombre: string }[];
  onCambio: (f: Filtro) => void;
}) {
  const t = useTranslations('Inbox.visibilidad');
  return (
    <select
      aria-label={t('filtroAsesor')}
      value={aValor(valor)}
      onChange={(e) => onCambio(deValor(e.target.value))}
      className="h-7 max-w-40 rounded-md bg-transparent px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <option value="todos">{t('todos')}</option>
      <option value="sin-asignar">{t('sinAsignar')}</option>
      {asesores.map((a) => (
        <option key={a.userId} value={`asesor:${a.userId}`}>
          {a.nombre}
        </option>
      ))}
    </select>
  );
}
