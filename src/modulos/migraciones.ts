import path from 'node:path';
import {
  MIGRACION_MODULO,
  MIGRACION_WACRM,
  type DefinicionModulo,
} from '@contracts/mod/module';

export interface ProblemaMigracion {
  archivo: string;
  motivo: string;
}

export const DIR_MIGRACIONES = path.join(process.cwd(), 'supabase/migrations');

/**
 * Problemas: archivo que no es ni de wacrm ni de módulo; mod_*.sql de un módulo
 * no registrado; migración declarada por un módulo que no está en la carpeta.
 */
export function verificarMigraciones(
  archivos: readonly string[],
  modulos: readonly DefinicionModulo<unknown>[]
): ProblemaMigracion[] {
  const problemas: ProblemaMigracion[] = [];
  const registrados = new Set(modulos.map((m) => m.nombre));
  for (const archivo of archivos) {
    if (MIGRACION_WACRM.test(archivo)) continue;
    const m = MIGRACION_MODULO.exec(archivo);
    if (!m) {
      problemas.push({
        archivo,
        motivo: 'no es ni migración de wacrm ni de módulo',
      });
    } else if (!registrados.has(m[1])) {
      problemas.push({
        archivo,
        motivo: `módulo no registrado: ${m[1]}`,
      });
    }
  }
  const presentes = new Set(archivos);
  for (const mod of modulos) {
    for (const archivo of mod.migraciones) {
      if (!presentes.has(archivo)) {
        problemas.push({
          archivo,
          motivo: `declarada por ${mod.nombre} pero ausente de la carpeta`,
        });
      }
    }
  }
  return problemas;
}
