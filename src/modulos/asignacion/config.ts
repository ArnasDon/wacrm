import { z } from 'zod';

/** Reglas que el motor conoce, en el orden en que pueden evaluarse. */
export const REGLAS_ASIGNACION = [
  'asesor-previo',
  'etiqueta',
  'palabra-clave',
  'campo',
  'reparto-equitativo',
] as const;

export type ReglaAsignacion = (typeof REGLAS_ASIGNACION)[number];

export type ConfigAsignacion = { reglas: ReglaAsignacion[] };

export const ConfigAsignacionSchema: z.ZodType<ConfigAsignacion> =
  z.strictObject({
    reglas: z
      .array(z.enum(REGLAS_ASIGNACION))
      .min(1)
      .default([...REGLAS_ASIGNACION])
      .refine((r) => new Set(r).size === r.length, {
        message: 'las reglas no pueden repetirse',
      })
      .refine(
        (r) =>
          !r.includes('reparto-equitativo') ||
          r.at(-1) === 'reparto-equitativo',
        {
          message: 'reparto-equitativo solo puede ir al final',
        }
      ),
  });
