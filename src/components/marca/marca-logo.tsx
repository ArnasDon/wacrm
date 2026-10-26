'use client';

import { cn } from '@/lib/utils';
import { useMarca } from './marca-context';

/** Logo compacto de la empresa (o isotipo de Stackless si no subió uno). */
export function MarcaLogo({ className }: { className?: string }) {
  const marca = useMarca();
  return (
    // eslint-disable-next-line @next/next/no-img-element -- logo servido desde config/, sin optimizador
    <img
      src={marca.marcaUrl}
      alt={marca.nombre}
      className={cn('shrink-0 rounded-lg object-contain', className)}
    />
  );
}
