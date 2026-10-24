import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigEmpresaError, cargarConfigEmpresa } from './config-empresa';

const ENV_OK = {
  BACKUP_DESTINO_URI: 's3://backups/baru',
  BACKUP_DESTINO_CREDENCIAL: 'type = s3',
  BACKUP_AVISO_WEBHOOK: 'https://avisos.example.com/b',
};

let dir: string;

function escribir(relativa: string, contenido: string) {
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, relativa), contenido);
}

function config(opciones: { empresa?: string; modulos?: string } = {}) {
  escribir(
    'config/empresa.yaml',
    opciones.empresa ?? 'empresa:\n  id: baru\n  nombre: "Barú"\n'
  );
  escribir(
    'config/modules.yaml',
    opciones.modulos ?? 'modulos:\n  asignacion:\n    activo: true\n'
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'config-empresa-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('cargarConfigEmpresa', () => {
  it('arma un TenantConfig válido desde config/ y el entorno', () => {
    config();
    const c = cargarConfigEmpresa(dir, ENV_OK);
    expect(c.empresa).toEqual({ id: 'baru', nombre: 'Barú' });
    expect(c.modulos.asignacion).toEqual({ activo: true, config: {} });
    expect(c.backup.destinoUri).toBe('s3://backups/baru');
    expect(c.policiesPath).toBe('config/policies.yaml');
  });

  it('conserva un nombre con dos puntos, comillas y tildes', () => {
    config({
      empresa: `empresa:\n  id: baru\n  nombre: ${JSON.stringify('Grifería "Barú": Cartagena')}\n`,
    });
    expect(cargarConfigEmpresa(dir, ENV_OK).empresa.nombre).toBe(
      'Grifería "Barú": Cartagena'
    );
  });

  it('toma un modules.yaml vacío o solo con comentarios como sin módulos', () => {
    config({ modulos: '# nada\n' });
    expect(cargarConfigEmpresa(dir, ENV_OK).modulos).toEqual({});
  });

  it('rechaza una llave desconocida en modules.yaml', () => {
    config({ modulos: 'modulo:\n  asignacion:\n    activo: true\n' });
    expect(() => cargarConfigEmpresa(dir, ENV_OK)).toThrow(ConfigEmpresaError);
  });

  it.each([
    ['BACKUP_DESTINO_URI', '<s3://bucket/ruta — lo usa BAK.1>'],
    ['BACKUP_DESTINO_CREDENCIAL', ''],
    ['BACKUP_AVISO_WEBHOOK', undefined],
  ])(
    'falla nombrando %s cuando quedó con marcador, vacía o sin definir',
    (variable, valor) => {
      config();
      expect(() =>
        cargarConfigEmpresa(dir, { ...ENV_OK, [variable]: valor })
      ).toThrow(variable);
    }
  );

  it('falla nombrando la variable cuando el valor no pasa el contrato', () => {
    config();
    expect(() =>
      cargarConfigEmpresa(dir, { ...ENV_OK, BACKUP_AVISO_WEBHOOK: 'no-url' })
    ).toThrow('BACKUP_AVISO_WEBHOOK');
  });

  it('falla nombrando el archivo cuando falta config/empresa.yaml', () => {
    expect(() => cargarConfigEmpresa(dir, ENV_OK)).toThrow(
      'config/empresa.yaml'
    );
  });
});
