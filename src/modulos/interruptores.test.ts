import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dirConfigEmpresa,
  ErrorInterruptores,
  leerInterruptores,
} from './interruptores';

const dirs: string[] = [];
const dirVacio = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'modulos-'));
  dirs.push(d);
  return d;
};
const conYaml = (texto: string) => {
  const d = dirVacio();
  fs.writeFileSync(path.join(d, 'modules.yaml'), texto);
  return d;
};

afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

describe('leerInterruptores', () => {
  it('sin modules.yaml: todo apagado (R16)', () => {
    expect(leerInterruptores(dirVacio())).toEqual({});
  });
  it('archivo vacío: todo apagado', () => {
    expect(leerInterruptores(conYaml(''))).toEqual({});
  });
  it('lee interruptores con la forma de CT.1 y aplica el default de config', () => {
    expect(
      leerInterruptores(
        conYaml(
          'modulos:\n  demo:\n    activo: true\n  otro:\n    activo: false\n'
        )
      )
    ).toEqual({
      demo: { activo: true, config: {} },
      otro: { activo: false, config: {} },
    });
  });
  it('llave desconocida (activa en vez de activo) → ErrorInterruptores', () => {
    expect(() =>
      leerInterruptores(conYaml('modulos:\n  demo:\n    activa: true\n'))
    ).toThrow(ErrorInterruptores);
  });
  it('llave de primer nivel desconocida → ErrorInterruptores', () => {
    expect(() => leerInterruptores(conYaml('modules: {}\n'))).toThrow(
      /modules\.yaml/
    );
  });
  it('YAML ilegible → ErrorInterruptores', () => {
    expect(() => leerInterruptores(conYaml('modulos: [\n'))).toThrow(
      ErrorInterruptores
    );
  });
  it('por defecto lee CONFIG_EMPRESA_DIR', () => {
    vi.stubEnv('CONFIG_EMPRESA_DIR', '/x/y');
    expect(dirConfigEmpresa()).toBe('/x/y');
    vi.unstubAllEnvs();
    expect(dirConfigEmpresa()).toBe(path.join(process.cwd(), 'config'));
  });
});

describe('modulos: vacío', () => {
  it('`modulos:` sin entradas = todo apagado', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'intr-'));
    fs.writeFileSync(path.join(d, 'modules.yaml'), 'modulos:\n  # demo:\n');
    expect(leerInterruptores(d)).toEqual({});
    fs.rmSync(d, { recursive: true, force: true });
  });
});
