import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import { z } from 'zod';

import {
  ModulosSchema,
  TenantConfigSchema,
  type TenantConfig,
} from '../../contracts/cfg/tenant-config';

export class ConfigEmpresaError extends Error {}

const VARIABLES_BACKUP = {
  destinoUri: 'BACKUP_DESTINO_URI',
  credencial: 'BACKUP_DESTINO_CREDENCIAL',
  avisoWebhook: 'BACKUP_AVISO_WEBHOOK',
} as const;

const ModulesYamlSchema = z.strictObject({ modulos: ModulosSchema });

function leerYaml(raiz: string, relativa: string): unknown {
  const ruta = join(raiz, relativa);
  if (!existsSync(ruta)) {
    throw new ConfigEmpresaError(`Falta ${relativa}`);
  }
  try {
    return load(readFileSync(ruta, 'utf8'));
  } catch (e) {
    throw new ConfigEmpresaError(
      `${relativa} no es YAML válido: ${(e as Error).message}`
    );
  }
}

function valorDeVariable(
  env: Record<string, string | undefined>,
  nombre: string
): string {
  const valor = env[nombre]?.trim();
  if (!valor || valor.startsWith('<')) {
    throw new ConfigEmpresaError(
      `${nombre} está vacía, sin definir o con el marcador de .env.example`
    );
  }
  return valor;
}

/** Lee `config/` y el entorno de un repo hijo y devuelve un TenantConfig validado. */
export function cargarConfigEmpresa(
  raiz: string,
  env: Record<string, string | undefined>
): TenantConfig {
  const empresaYaml = leerYaml(raiz, 'config/empresa.yaml');
  const modulesYaml = leerYaml(raiz, 'config/modules.yaml');

  const modules = ModulesYamlSchema.safeParse(modulesYaml ?? { modulos: {} });
  if (!modules.success) {
    throw new ConfigEmpresaError(
      `config/modules.yaml inválido: ${z.prettifyError(modules.error)}`
    );
  }

  const backup = {
    destinoUri: valorDeVariable(env, VARIABLES_BACKUP.destinoUri),
    credencial: valorDeVariable(env, VARIABLES_BACKUP.credencial),
    avisoWebhook: valorDeVariable(env, VARIABLES_BACKUP.avisoWebhook),
  };

  const resultado = TenantConfigSchema.safeParse({
    ...(typeof empresaYaml === 'object' && empresaYaml !== null
      ? (empresaYaml as object)
      : {}),
    modulos: modules.data.modulos,
    backup,
  });
  if (!resultado.success) {
    const primero = resultado.error.issues[0];
    const [raizPath, hoja] = primero?.path ?? [];
    const variable =
      raizPath === 'backup' && typeof hoja === 'string'
        ? VARIABLES_BACKUP[hoja as keyof typeof VARIABLES_BACKUP]
        : undefined;
    const donde = variable ?? 'config/empresa.yaml';
    throw new ConfigEmpresaError(
      `${donde} inválido: ${z.prettifyError(resultado.error)}`
    );
  }
  return resultado.data;
}
