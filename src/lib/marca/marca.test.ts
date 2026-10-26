import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COLOR_DEFECTO, leerMarca, rutaLogoPropio } from './marca';

const dirs: string[] = [];
function conf(archivos: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marca-'));
  dirs.push(dir);
  for (const [rel, contenido] of Object.entries(archivos)) {
    const ruta = path.join(dir, rel);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, contenido);
  }
  return dir;
}
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

const EMPRESA = 'empresa:\n  id: baru\n  nombre: "Grifería Barú"\n';

describe('leerMarca', () => {
  it('sin config → marca Stackless por defecto', () => {
    const m = leerMarca(conf({}));
    expect(m).toEqual({
      nombre: 'Stackless',
      color: COLOR_DEFECTO,
      logoPropio: false,
      logoUrl: '/stackless/logo.png',
      marcaUrl: '/stackless/mark.png',
    });
  });

  it('con empresa, color y logo propios', () => {
    const m = leerMarca(
      conf({
        'empresa.yaml': EMPRESA,
        'marca.yaml': 'marca:\n  color: "#e11d48"\n  logo: logo.png\n',
        'marca/logo.png': 'x',
      })
    );
    expect(m.nombre).toBe('Grifería Barú');
    expect(m.color).toBe('#e11d48');
    expect(m.logoPropio).toBe(true);
    expect(m.logoUrl).toBe('/marca/logo');
    expect(m.marcaUrl).toBe('/marca/logo');
  });

  it('empresa sin marca.yaml → nombre propio, resto por defecto', () => {
    const m = leerMarca(conf({ 'empresa.yaml': EMPRESA }));
    expect(m.nombre).toBe('Grifería Barú');
    expect(m.color).toBe(COLOR_DEFECTO);
    expect(m.logoPropio).toBe(false);
  });

  it('YAML roto → por defecto, sin lanzar', () => {
    const m = leerMarca(conf({ 'empresa.yaml': ': : [', 'marca.yaml': '{{{' }));
    expect(m.nombre).toBe('Stackless');
    expect(m.color).toBe(COLOR_DEFECTO);
  });

  it('color inválido → color por defecto', () => {
    const m = leerMarca(conf({ 'marca.yaml': 'marca:\n  color: red\n' }));
    expect(m.color).toBe(COLOR_DEFECTO);
  });
});

describe('rutaLogoPropio', () => {
  it('rechaza rutas que salen de config/marca/', () => {
    const dir = conf({
      'marca.yaml': 'marca:\n  logo: ../secreto.png\n',
      'secreto.png': 'x',
    });
    expect(rutaLogoPropio(dir)).toBeNull();
  });

  it('rechaza extensiones no permitidas', () => {
    const dir = conf({
      'marca.yaml': 'marca:\n  logo: logo.gif\n',
      'marca/logo.gif': 'x',
    });
    expect(rutaLogoPropio(dir)).toBeNull();
  });

  it('rechaza si el archivo no existe', () => {
    const dir = conf({ 'marca.yaml': 'marca:\n  logo: logo.png\n' });
    expect(rutaLogoPropio(dir)).toBeNull();
  });

  it('devuelve ruta y tipo MIME', () => {
    const dir = conf({
      'marca.yaml': 'marca:\n  logo: logo.svg\n',
      'marca/logo.svg': '<svg/>',
    });
    expect(rutaLogoPropio(dir)).toEqual({
      ruta: path.join(dir, 'marca', 'logo.svg'),
      tipo: 'image/svg+xml',
    });
  });
});
