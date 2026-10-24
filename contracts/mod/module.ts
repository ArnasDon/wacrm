/**
 * Contrato I3 · Mecanismo de módulos (origen 04-modulos#i3).
 * Publica MOD (MOD.1); consumen ASG y VIS. No lo cambies sin actualizar antes el PRD.
 *
 * Un módulo es: un nombre, un esquema zod de su config, sus migraciones con prefijo
 * propio (R17) y, opcional, un enganche en el flujo de entrada del fork (R19). El
 * interruptor y la config cruda vienen de I1 (`config/modules.yaml`).
 *
 * Convención de contracts/: `<carril>/<nombre>.ts`, `*.stub.ts`,
 * `*.cdc-<consumidor>.test.ts`, `*.publicador.test.ts`.
 */

import { z } from 'zod';
import type { ModuloSwitch } from '../cfg/tenant-config';

export const VERSION_CONTRATO = 'I3.v1';

/** Subconjunto del identificador de I1 sin guiones: el nombre va en `mod_<nombre>_` y en SQL. */
export const NOMBRE_MODULO = /^[a-z][a-z0-9]*$/;

/** `mod_<nombre>_NNN.sql` o `mod_<nombre>_NNN_<descripcion>.sql` (R17). */
export const MIGRACION_MODULO =
  /^mod_([a-z][a-z0-9]*)_(\d{3})(_[a-z0-9_]+)?\.sql$/;

/** Migraciones de wacrm: `NNN_<descripcion>.sql` (supabase/migrations). */
export const MIGRACION_WACRM = /^\d{3}_[a-z0-9_]+\.sql$/;

export function prefijoMigracion(nombre: string): string {
  return `mod_${nombre}_`;
}

export function esMigracionDeModulo(archivo: string, nombre: string): boolean {
  const m = MIGRACION_MODULO.exec(archivo);
  return m !== null && m[1] === nombre;
}

/**
 * Orden en que corren las migraciones: el mismo que el glob `/migrations/*.sql`
 * (orden lexicográfico por byte). Todas las de wacrm quedan antes que las de módulos.
 */
export function ordenMigraciones(archivos: readonly string[]): string[] {
  return [...archivos].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Lo que el flujo de entrada le pasa a cada módulo encendido, por mensaje entrante ya guardado. */
export const EventoEntradaSchema = z.strictObject({
  cuentaId: z.uuid(),
  conversacionId: z.uuid(),
  contactoId: z.uuid(),
  mensajeId: z.uuid(),
  /** `null` = conversación sin asesor (lo que dispara ASG, R21). */
  asesorAsignadoId: z.uuid().nullable(),
  conversacionNueva: z.boolean(),
  recibidoEn: z.iso.datetime({ offset: true }),
});

export type EventoEntrada = z.infer<typeof EventoEntradaSchema>;

export interface DefinicionModulo<C> {
  nombre: string;
  configSchema: z.ZodType<C>;
  migraciones: readonly string[];
  /** Sintaxis de método a propósito: deja registrar módulos de config distinta en una lista. */
  alEntrarMensaje?(evento: EventoEntrada, config: C): Promise<void>;
}

export type ModuloCargado<C> =
  | { nombre: string; activo: false }
  | {
      nombre: string;
      activo: true;
      config: C;
      alEntrarMensaje?(evento: EventoEntrada, config: C): Promise<void>;
    };

export class ErrorDefinicionModulo extends Error {
  override name = 'ErrorDefinicionModulo';
}

export class ErrorConfigModulo extends Error {
  override name = 'ErrorConfigModulo';
  constructor(
    readonly modulo: string,
    readonly problemas: z.core.$ZodIssue[]
  ) {
    super(
      `config inválida del módulo ${modulo}: ${problemas
        .map((p) => `${p.path.join('.') || '(raíz)'}: ${p.message}`)
        .join('; ')}`
    );
  }
}

/** Valida nombre y migraciones al declarar el módulo; falla al importar, no en producción. */
export function definirModulo<C>(
  def: DefinicionModulo<C>
): DefinicionModulo<C> {
  if (!NOMBRE_MODULO.test(def.nombre)) {
    throw new ErrorDefinicionModulo(`nombre de módulo inválido: ${def.nombre}`);
  }
  for (const archivo of def.migraciones) {
    if (!esMigracionDeModulo(archivo, def.nombre)) {
      throw new ErrorDefinicionModulo(
        `la migración ${archivo} no lleva el prefijo ${prefijoMigracion(def.nombre)}NNN`
      );
    }
  }
  if (new Set(def.migraciones).size !== def.migraciones.length) {
    throw new ErrorDefinicionModulo(`migraciones repetidas en ${def.nombre}`);
  }
  return Object.freeze({
    ...def,
    migraciones: Object.freeze([...def.migraciones]),
  });
}

/**
 * Cruza la definición con su interruptor de I1. Apagado o no declarado: no se valida
 * ni se engancha nada (R16). Encendido: la config pasa por el esquema del módulo y,
 * si no cumple, lanza ErrorConfigModulo (R18: el arranque falla).
 */
export function cargarModulo<C>(
  def: DefinicionModulo<C>,
  interruptor: ModuloSwitch | undefined
): ModuloCargado<C> {
  if (!interruptor?.activo) return { nombre: def.nombre, activo: false };
  const r = def.configSchema.safeParse(interruptor.config);
  if (!r.success) throw new ErrorConfigModulo(def.nombre, r.error.issues);
  return {
    nombre: def.nombre,
    activo: true,
    config: r.data,
    alEntrarMensaje: def.alEntrarMensaje,
  };
}
