import { describe, expect, it } from 'vitest';
import {
  EJEMPLOS_TEMPLATE,
  RUTAS_EMPRESA,
  esRutaDeEmpresa,
} from './tenant-config';
import { stubRutasEmpresa } from './tenant-config.stub';

// Lo que UPD.1 hará: por cada ruta del diff del merge del template, preguntar
// al contrato si es de la empresa; si alguna lo es, el chequeo falla.
function rutasBloqueadas(diff: readonly string[]) {
  return diff.filter((ruta) => esRutaDeEmpresa(ruta));
}

describe('CDC UPD.1 · el chequeo del merge del template', () => {
  it('rechaza un cambio del template que toca una ruta de la empresa', () => {
    const diff = ['src/app/page.tsx', 'config/policies.yaml'];
    expect(rutasBloqueadas(diff)).toEqual(['config/policies.yaml']);
  });

  it('deja pasar un cambio que solo toca archivos del template', () => {
    const diff = [
      'src/lib/whatsapp/client.ts',
      'docker-compose.yml',
      'supabase/migrations/0002_inbox.sql',
      'package.json',
      ...EJEMPLOS_TEMPLATE,
    ];
    expect(rutasBloqueadas(diff)).toEqual([]);
  });

  it('bloquea toda ruta que el stub declara de la empresa', () => {
    expect(rutasBloqueadas(stubRutasEmpresa())).toEqual([
      ...stubRutasEmpresa(),
    ]);
  });

  it('bloquea las rutas obligatorias del contrato', () => {
    expect(rutasBloqueadas(RUTAS_EMPRESA)).toEqual([...RUTAS_EMPRESA]);
  });

  it('no se deja engañar por la forma de escribir la ruta', () => {
    expect(
      rutasBloqueadas(['./config/modules.yaml', 'config//modules.yaml'])
    ).toHaveLength(2);
  });

  it('no bloquea un diff vacío', () => {
    expect(rutasBloqueadas([])).toEqual([]);
  });
});
