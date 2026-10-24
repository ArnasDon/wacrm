/**
 * Stub del contrato I1. Las factorías pasan por TenantConfigSchema.parse: si el
 * contrato cambia y el stub queda inválido, su propia prueba falla.
 */

import {
  RUTAS_EMPRESA,
  TenantConfigSchema,
  type TenantConfig,
  type TenantConfigEntrada,
} from './tenant-config';

export type OverridesStub = {
  empresa?: Partial<TenantConfigEntrada['empresa']>;
  backup?: Partial<Record<keyof TenantConfig['backup'], unknown>>;
  modulos?: Record<
    string,
    { activo?: boolean; config?: Record<string, unknown> }
  >;
};

export function stubTenantConfig(overrides: OverridesStub = {}): TenantConfig {
  const modulosBase: Record<
    string,
    { activo: boolean; config: Record<string, unknown> }
  > = {
    asignacion: { activo: false, config: {} },
  };
  const modulos = { ...modulosBase };
  for (const [nombre, o] of Object.entries(overrides.modulos ?? {})) {
    modulos[nombre] = {
      activo: o.activo ?? modulosBase[nombre]?.activo ?? false,
      config: o.config ?? modulosBase[nombre]?.config ?? {},
    };
  }
  return TenantConfigSchema.parse({
    empresa: {
      id: 'empresa-demo',
      nombre: 'Empresa Demo',
      ...overrides.empresa,
    },
    backup: {
      destinoUri: 's3://backups-demo/empresa-demo',
      credencial: 'credencial-demo',
      avisoWebhook: 'https://avisos.ejemplo.com/backup',
      ...overrides.backup,
    },
    modulos,
  });
}

export function stubRutasEmpresa(): readonly string[] {
  return [...RUTAS_EMPRESA, '.env.local'];
}
