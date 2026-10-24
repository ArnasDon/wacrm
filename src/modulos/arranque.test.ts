import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { definirModulo, type EventoEntrada } from '@contracts/mod/module';
import { stubEventoEntrada } from '@contracts/mod/module.stub';
import {
  despacharEntradaAModulos,
  fijarFlujoEntrada,
  obtenerFlujoEntrada,
} from './arranque';
import { crearFlujoEntrada } from './flujo-entrada';

const dirs: string[] = [];
const dirVacio = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'arranque-'));
  dirs.push(d);
  return d;
};
const conYaml = (t: string) => {
  const d = dirVacio();
  fs.writeFileSync(path.join(d, 'modules.yaml'), t);
  return d;
};
const demo = (enganche: (e: EventoEntrada) => Promise<void>) =>
  definirModulo({
    nombre: 'demo',
    configSchema: z.strictObject({ limite: z.number() }),
    migraciones: [],
    alEntrarMensaje: enganche,
  }) as never;
const on = { demo: { activo: true, config: { limite: 1 } } };

afterEach(() => {
  fijarFlujoEntrada(undefined);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

describe('arranque', () => {
  it('obtenerFlujoEntrada arranca una sola vez', () => {
    vi.stubEnv('CONFIG_EMPRESA_DIR', dirVacio());
    expect(obtenerFlujoEntrada()).toBe(obtenerFlujoEntrada());
  });
  it('despachar con todo apagado no valida el evento ni lanza', async () => {
    fijarFlujoEntrada(crearFlujoEntrada([], {}));
    await expect(
      despacharEntradaAModulos({ cuentaId: 'acc-1' } as never)
    ).resolves.toBeUndefined();
  });
  it('despachar con un evento inválido registra y no llama al enganche', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const espia = vi.fn(async () => {});
    fijarFlujoEntrada(crearFlujoEntrada([demo(espia)], on));
    await despacharEntradaAModulos({
      ...stubEventoEntrada(),
      conversacionId: 'conv-1',
    });
    expect(espia).not.toHaveBeenCalled();
  });
  it('despachar entrega el evento al enganche', async () => {
    const espia = vi.fn(async () => {});
    fijarFlujoEntrada(crearFlujoEntrada([demo(espia)], on));
    const e = stubEventoEntrada();
    await despacharEntradaAModulos(e);
    expect(espia).toHaveBeenCalledWith(e, { limite: 1 });
  });
  it('despachar no lanza si el arranque falla', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('CONFIG_EMPRESA_DIR', conYaml('modulos: [\n'));
    await expect(
      despacharEntradaAModulos(stubEventoEntrada())
    ).resolves.toBeUndefined();
  });
});
