/**
 * Esquema de config/policies.yaml (CFG.2, R14): las políticas nativas de wacrm de una empresa.
 * Sin dependencias del código de la app (no importa nada de src/).
 */
import { readFileSync } from 'node:fs';

import yaml from 'js-yaml';
import { z } from 'zod';

export class PoliciesInvalidasError extends Error {
  /** @param {string[]} problemas "ruta.del.campo: mensaje" */
  constructor(problemas) {
    super(`policies.yaml inválido:\n- ${problemas.join('\n- ')}`);
    this.name = 'PoliciesInvalidasError';
    this.problemas = problemas;
  }
}

const COLOR = /^#[0-9a-f]{6}$/i;
const HORARIO = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

const color = z
  .string()
  .regex(COLOR, 'debe ser un color #rrggbb')
  .default('#3b82f6');
const texto = z.string().trim().min(1, 'no puede estar vacío');

function zonaValida(zona) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

function sinRepetidos(valores, ctx, ruta, que) {
  const vistos = new Set();
  for (const v of valores) {
    const k = v.toLowerCase();
    if (vistos.has(k)) {
      ctx.addIssue({
        code: 'custom',
        path: ruta,
        message: `${que} repetido: "${v}"`,
      });
    }
    vistos.add(k);
  }
}

const ROLES = { owner: 'owner', admin: 'admin', asesor: 'agent' };

const Usuario = z.strictObject({
  correo: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'correo inválido'),
  nombre: texto,
  rol: z.enum(['owner', 'admin', 'asesor']),
});

const Etiqueta = z.strictObject({ nombre: texto, color });
const Etapa = z.strictObject({ nombre: texto, color });

const Bienvenida = z.strictObject({
  activa: z.boolean().default(true),
  texto,
});

const FueraDeHorario = z.strictObject({
  activa: z.boolean().default(true),
  texto,
  horario: z
    .string()
    .regex(HORARIO, 'debe ser HH:mm-HH:mm (24 horas), p. ej. 18:00-08:00'),
  zona: z
    .string()
    .refine(
      zonaValida,
      'zona horaria IANA inexistente (p. ej. America/Bogota)'
    ),
});

export const PoliciesSchema = z
  .strictObject({
    version: z.literal(1),
    usuarios: z.array(Usuario).min(1, 'al menos un usuario (el owner)'),
    etiquetas: z.array(Etiqueta).default([]),
    embudo: z
      .strictObject({
        nombre: texto,
        etapas: z.array(Etapa).min(1, 'al menos una etapa'),
      })
      .optional(),
    automatizaciones: z
      .strictObject({
        bienvenida: Bienvenida.optional(),
        fuera_de_horario: FueraDeHorario.optional(),
      })
      .default({}),
    bot: z
      .strictObject({
        activo: z.boolean(),
        respuesta_automatica: z.boolean().default(false),
        tope_por_conversacion: z.number().int().min(1).max(20).default(3),
      })
      .optional(),
  })
  .superRefine((p, ctx) => {
    const owners = p.usuarios.filter((u) => u.rol === 'owner').length;
    if (owners !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['usuarios'],
        message: `debe haber exactamente un usuario con rol owner (hay ${owners})`,
      });
    }
    sinRepetidos(
      p.usuarios.map((u) => u.correo),
      ctx,
      ['usuarios'],
      'correo'
    );
    sinRepetidos(
      p.etiquetas.map((e) => e.nombre),
      ctx,
      ['etiquetas'],
      'etiqueta'
    );
    if (p.embudo) {
      sinRepetidos(
        p.embudo.etapas.map((e) => e.nombre),
        ctx,
        ['embudo', 'etapas'],
        'etapa'
      );
    }
  })
  .transform((p) => ({
    ...p,
    usuarios: p.usuarios.map((u) => ({ ...u, rolCuenta: ROLES[u.rol] })),
  }));

/** @returns {z.output<typeof PoliciesSchema>} */
export function validarPolicies(datos) {
  const r = PoliciesSchema.safeParse(datos);
  if (r.success) return r.data;
  throw new PoliciesInvalidasError(
    r.error.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`)
  );
}

/** Lee y valida un policies.yaml. Archivo ausente o YAML roto => PoliciesInvalidasError. */
export function leerPolicies(ruta) {
  let crudo;
  try {
    crudo = readFileSync(ruta, 'utf8');
  } catch {
    throw new PoliciesInvalidasError([`no se pudo leer ${ruta}`]);
  }
  let datos;
  try {
    datos = yaml.load(crudo);
  } catch (e) {
    throw new PoliciesInvalidasError([
      `YAML ilegible: ${e instanceof Error ? e.message.split('\n')[0] : e}`,
    ]);
  }
  return validarPolicies(datos);
}
