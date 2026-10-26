import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GET } from './route';

const previo = process.env.CONFIG_EMPRESA_DIR;
const dirs: string[] = [];
afterEach(() => {
  if (previo === undefined) delete process.env.CONFIG_EMPRESA_DIR;
  else process.env.CONFIG_EMPRESA_DIR = previo;
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

function conConfig(archivos: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-'));
  dirs.push(dir);
  for (const [rel, c] of Object.entries(archivos)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), c);
  }
  process.env.CONFIG_EMPRESA_DIR = dir;
}

describe('GET /marca/logo', () => {
  it('sirve el logo propio con su content-type', async () => {
    conConfig({
      'marca.yaml': 'marca:\n  logo: logo.png\n',
      'marca/logo.png': 'PNGDATA',
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('max-age=300');
    expect(await res.text()).toBe('PNGDATA');
  });

  it('404 si la empresa no tiene logo propio', async () => {
    conConfig({});
    expect((await GET()).status).toBe(404);
  });
});
