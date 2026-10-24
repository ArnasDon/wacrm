import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fijarFlujoEntrada } from '@/modulos/arranque';
import { register } from './instrumentation';

vi.mock('@/modulos/registro', async () => {
  const { z } = await import('zod');
  const { definirModulo } = await import('@contracts/mod/module');
  return {
    MODULOS: [
      definirModulo({
        nombre: 'demo',
        configSchema: z.strictObject({ limite: z.number().int().positive() }),
        migraciones: [],
      }),
    ],
  };
});

let exit: ReturnType<typeof vi.spyOn>;
const dirs: string[] = [];
const dirVacio = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-'));
  dirs.push(d);
  return d;
};
const conYaml = (t: string) => {
  const d = dirVacio();
  fs.writeFileSync(path.join(d, 'modules.yaml'), t);
  return d;
};

beforeEach(() => {
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
  fijarFlujoEntrada(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  exit = vi
    .spyOn(process, 'exit')
    .mockImplementation((() => undefined) as never);
});
afterEach(() => {
  fijarFlujoEntrada(undefined);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

describe('register (arranque)', () => {
  it('config válida: arranca', async () => {
    vi.stubEnv(
      'CONFIG_EMPRESA_DIR',
      conYaml(
        'modulos:\n  demo:\n    activo: true\n    config:\n      limite: 2\n'
      )
    );
    await expect(register()).resolves.toBeUndefined();
    expect(exit).not.toHaveBeenCalled();
  });
  it('config de módulo inválida: el arranque sale con 1 (R18)', async () => {
    vi.stubEnv(
      'CONFIG_EMPRESA_DIR',
      conYaml(
        'modulos:\n  demo:\n    activo: true\n    config:\n      limite: 0\n'
      )
    );
    await register();
    expect(exit).toHaveBeenCalledWith(1);
  });
  it('módulo encendido que no existe: el arranque falla', async () => {
    vi.stubEnv(
      'CONFIG_EMPRESA_DIR',
      conYaml('modulos:\n  asignacoin:\n    activo: true\n')
    );
    await register();
    expect(exit).toHaveBeenCalledWith(1);
  });
  it('modules.yaml con forma inválida: el arranque falla', async () => {
    vi.stubEnv(
      'CONFIG_EMPRESA_DIR',
      conYaml('modulos:\n  demo:\n    activa: true\n')
    );
    await register();
    expect(exit).toHaveBeenCalledWith(1);
  });
  it('sin config/: arranca con todo apagado', async () => {
    vi.stubEnv('CONFIG_EMPRESA_DIR', dirVacio());
    await expect(register()).resolves.toBeUndefined();
    expect(exit).not.toHaveBeenCalled();
  });
  it('en el runtime edge no hace nada', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    vi.stubEnv(
      'CONFIG_EMPRESA_DIR',
      conYaml(
        'modulos:\n  demo:\n    activo: true\n    config:\n      limite: 0\n'
      )
    );
    await expect(register()).resolves.toBeUndefined();
    expect(exit).not.toHaveBeenCalled();
  });
});
