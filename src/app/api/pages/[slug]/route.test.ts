import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

// ── Aislamiento: el route escribe en process.cwd()/landing/src/data/landings.
// Mockeamos cwd a un tmp y la auth (getCurrentAccount) para probar el
// contrato HTTP sin tocar el repo real ni requerir sesión.
const TMP = '/tmp/wacrm-api-pages-test';
const DIR = join(TMP, 'landing', 'src', 'data', 'landings');

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: vi.fn().mockResolvedValue({ id: 'test-user' }),
  toErrorResponse: (err: unknown) =>
    new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 }),
}));

import { GET, PUT } from '@/app/api/pages/[slug]/route';

async function call(
  handler: (req: Request, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>,
  slug: string,
  body?: unknown,
) {
  const req = new Request('http://localhost/api/pages/' + slug, {
    method: body !== undefined ? 'PUT' : 'GET',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await handler(req, { params: Promise.resolve({ slug }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe('api/pages/[slug]', () => {
  beforeEach(async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(TMP);
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      join(DIR, 'home.json'),
      JSON.stringify({ title: 'Home', description: 'Desc', blocks: [] }),
      'utf-8',
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(TMP, { recursive: true, force: true });
  });

  it('GET devuelve la página existente', async () => {
    const { status, json } = await call(GET, 'home');
    expect(status).toBe(200);
    expect(json.page.title).toBe('Home');
  });

  it('GET devuelve 404 si el slug no existe', async () => {
    const { status } = await call(GET, 'no-existe');
    expect(status).toBe(404);
  });

  it('PUT guarda y persiste el documento completo', async () => {
    const body = {
      title: 'Home editado',
      description: 'Meta nueva',
      blocks: [{ type: 'cta', data: { title: 'Empieza' } }],
    };
    const { status, json } = await call(PUT, 'home', body);
    expect(status).toBe(200);
    expect(json.page.title).toBe('Home editado');

    // Persistido en disco:
    const saved = JSON.parse(await fs.readFile(join(DIR, 'home.json'), 'utf-8'));
    expect(saved.title).toBe('Home editado');
    expect(saved.blocks[0].type).toBe('cta');
  });

  it('PUT rechaza body inválido con 400', async () => {
    const { status } = await call(PUT, 'home', { title: 'solo título' });
    expect(status).toBe(400);
  });

  it('PUT rechaza slug inválido con 400', async () => {
    const { status } = await call(PUT, 'Mal Slug', { title: 'A', description: '', blocks: [] });
    expect(status).toBe(400);
  });
});