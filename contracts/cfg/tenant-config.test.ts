import { describe, expect, it } from 'vitest';
import {
  EJEMPLOS_TEMPLATE,
  RUTAS_EMPRESA,
  VARS_EMPRESA,
  VERSION_CONTRATO,
  esRutaDeEmpresa,
  esVariableDeEmpresa,
} from './tenant-config';

describe('esRutaDeEmpresa', () => {
  it.each([
    '.env',
    '.env.local',
    '.env.production.local',
    'config/modules.yaml',
    'config/policies.yaml',
    'config/extra/lo-que-sea.yaml',
    './config/policies.yaml',
    'config//policies.yaml',
    'config/policies.yaml/',
  ])('reclama %s para la empresa', (ruta) => {
    expect(esRutaDeEmpresa(ruta)).toBe(true);
  });

  it.each([
    '.env.example',
    '.env.local.example',
    'src/app/page.tsx',
    'docker-compose.yml',
    'supabase/migrations/0001_init.sql',
    'package.json',
    'configuracion/policies.yaml',
    'Config/policies.yaml',
    '.ENV.local',
  ])('deja %s al template', (ruta) => {
    expect(esRutaDeEmpresa(ruta)).toBe(false);
  });
});

describe('esVariableDeEmpresa', () => {
  it.each([
    'ENCRYPTION_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'META_APP_SECRET',
    'BACKUP_DESTINO_URI',
    'BACKUP_DESTINO_CREDENCIAL',
    'BACKUP_AVISO_WEBHOOK',
  ])('reclama %s para la empresa', (nombre) => {
    expect(esVariableDeEmpresa(nombre)).toBe(true);
  });

  it.each(['NEXT_PUBLIC_APP_LOCALE', 'NODE_ENV', 'encryption_key'])(
    'deja %s al template',
    (nombre) => {
      expect(esVariableDeEmpresa(nombre)).toBe(false);
    }
  );
});

describe('el contrato se declara', () => {
  it('expone su versión', () => {
    expect(VERSION_CONTRATO).toBe('I1.v1');
  });

  it('obliga a modules.yaml y policies.yaml', () => {
    expect(RUTAS_EMPRESA).toEqual([
      'config/modules.yaml',
      'config/policies.yaml',
    ]);
  });

  it('no mete los ejemplos del template entre las rutas de la empresa', () => {
    for (const ejemplo of EJEMPLOS_TEMPLATE) {
      expect(RUTAS_EMPRESA).not.toContain(ejemplo);
    }
  });

  it('lista ENCRYPTION_KEY sin valor por defecto en ningún lado', () => {
    expect(VARS_EMPRESA).toContain('ENCRYPTION_KEY');
  });
});
