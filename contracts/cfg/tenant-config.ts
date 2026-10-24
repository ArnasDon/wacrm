/**
 * Contrato de la interfaz I1: qué archivos y variables son de la empresa y
 * cuáles del template, y la forma de la configuración por empresa.
 * Publica: CFG
 * Consumen: BAK, UPD, MOD
 *
 * Fuente: prd-hub, prds/wacrm-tenant-repo-template/slices/CT.1-contrato-config-empresa.md
 * (origen 04-modulos#i1). No lo cambies sin actualizar antes el PRD.
 *
 * Convención de contracts/: `<nombre>.ts` (contrato), `<nombre>.stub.ts` (stub),
 * `<nombre>.cdc-<consumidor>.test.ts` (CDC) y `<nombre>.publicador.test.ts`
 * (verificación del publicador, pendiente hasta que lo implemente su slice).
 */

import { z } from 'zod';

export const VERSION_CONTRATO = 'I1.v1';

/** Hora fija del backup diario; no es configurable (R9). */
export const HORA_BACKUP = '03:00';

/** Rutas obligatorias de la empresa. */
export const RUTAS_EMPRESA: readonly string[] = [
  'config/modules.yaml',
  'config/policies.yaml',
];

/** Todo lo que está bajo estos prefijos es de la empresa. */
export const PREFIJOS_EMPRESA: readonly string[] = ['config/'];

/** Ejemplos de variables: son del template aunque empiecen por `.env`. */
export const EJEMPLOS_TEMPLATE: readonly string[] = [
  '.env.example',
  '.env.local.example',
];

/** Variables de entorno de la empresa. ENCRYPTION_KEY nunca tiene valor por defecto (R7). */
export const VARS_EMPRESA: readonly string[] = [
  'ENCRYPTION_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'META_APP_SECRET',
  'BACKUP_DESTINO_URI',
  'BACKUP_DESTINO_CREDENCIAL',
  'BACKUP_AVISO_WEBHOOK',
];

function normalizar(ruta: string): string {
  let r = ruta.replace(/\/{2,}/g, '/');
  if (r.startsWith('./')) r = r.slice(2);
  if (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
  return r;
}

/** Comparación sensible a mayúsculas, para no depender del sistema de archivos. */
export function esRutaDeEmpresa(ruta: string): boolean {
  const r = normalizar(ruta);
  if (RUTAS_EMPRESA.includes(r)) return true;
  if (PREFIJOS_EMPRESA.some((p) => r.startsWith(p))) return true;
  const ultimo = r.slice(r.lastIndexOf('/') + 1);
  return ultimo.startsWith('.env') && !EJEMPLOS_TEMPLATE.includes(ultimo);
}

export function esVariableDeEmpresa(nombre: string): boolean {
  return VARS_EMPRESA.includes(nombre);
}

const IDENTIFICADOR = /^[a-z][a-z0-9-]*$/;

export const BackupConfigSchema = z.object({
  destinoUri: z.string().regex(/^(s3|b2|gs|file):\/\/.+/),
  credencial: z.string().min(1),
  avisoWebhook: z.url(),
  hora: z.literal(HORA_BACKUP).default(HORA_BACKUP),
});

export const ModuloSwitchSchema = z.object({
  activo: z.boolean(),
  /** Opaca en I1: su esquema lo fija CT.3 (I3). */
  config: z.record(z.string(), z.unknown()).default({}),
});

export const ModulosSchema = z
  .record(z.string().regex(IDENTIFICADOR), ModuloSwitchSchema)
  .default({});

export const TenantConfigSchema = z.strictObject({
  empresa: z.strictObject({
    id: z.string().regex(IDENTIFICADOR),
    nombre: z.string().min(1),
  }),
  backup: BackupConfigSchema,
  modulos: ModulosSchema,
  policiesPath: z
    .literal('config/policies.yaml')
    .default('config/policies.yaml'),
});

export type TenantConfig = z.infer<typeof TenantConfigSchema>;
export type TenantConfigEntrada = z.input<typeof TenantConfigSchema>;
export type ModuloSwitch = z.infer<typeof ModuloSwitchSchema>;

export function moduloDe(
  config: TenantConfig,
  nombre: string
): ModuloSwitch | undefined {
  return config.modulos[nombre];
}
