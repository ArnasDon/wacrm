import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// POST /api/v1/contacts — `tags` com forma errada é 400 ANTES de criar a
// ficha.
//
// O `filter((t) => typeof t === 'string')` que existia aqui descartava em
// silêncio o que não fosse texto. Mandando os objetos `{ id, name, color }`
// que o GET devolve, a lista virava VAZIA — e como o POST é find-or-create,
// com o telefone já na base a ficha EXISTENTE tinha todas as etiquetas
// substituídas por nada, com 200. O banco aqui grita se for tocado.
// ============================================================

const helpers = vi.hoisted(() => ({
  findOrCreateContact: vi.fn(),
  getContactById: vi.fn(),
  lerTagsPedidas: vi.fn(),
  setContactTags: vi.fn(),
  resolveAuditUserId: vi.fn(),
  from: vi.fn(() => {
    throw new Error('a rota consultou o banco antes de validar a entrada');
  }),
}));

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => ({ supabase: { from: helpers.from }, accountId: 'conta-1' })),
}));
vi.mock('@/lib/api/v1/contacts', () => ({
  CONTACT_SELECT: '*',
  serializeContact: (r: unknown) => r,
  findOrCreateContact: helpers.findOrCreateContact,
  getContactById: helpers.getContactById,
  lerTagsPedidas: helpers.lerTagsPedidas,
  setContactTags: helpers.setContactTags,
  resolveAuditUserId: helpers.resolveAuditUserId,
  ContactError: class ContactError extends Error {
    status = 500;
  },
}));
// O módulo real arrasta o motor de automações (via `tag-events`).
// `lerTagsDoCorpo` é o REAL: é a régua da forma de `tags` que estes testes
// cobram. O resto do módulo fica de fora (arrasta o motor de automações).
vi.mock('@/lib/api/v1/tags-do-contato', async (importOriginal) => ({
  lerTagsDoCorpo: (await importOriginal<typeof import('@/lib/api/v1/tags-do-contato')>())
    .lerTagsDoCorpo,
  TagReferenceError: class TagReferenceError extends Error {
    code = 'unknown_tag_ids';
    status = 400;
  },
}));

import { POST } from './route';

const ETIQUETA = '0f0f0f0f-1111-4222-8333-444444444444';

const post = (corpo: unknown) =>
  POST(
    new Request('http://localhost/api/v1/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
      body: JSON.stringify(corpo),
    })
  );

beforeEach(() => {
  for (const f of Object.values(helpers)) f.mockClear();
  helpers.findOrCreateContact.mockResolvedValue({ id: 'c1', created: false });
  helpers.getContactById.mockResolvedValue({ id: 'c1', tags: [] });
  helpers.lerTagsPedidas.mockResolvedValue({ ids: [ETIQUETA], nomesNovos: [] });
  helpers.setContactTags.mockResolvedValue(undefined);
  helpers.resolveAuditUserId.mockResolvedValue('usuario-de-auditoria');
});

describe('POST /api/v1/contacts — `tags` com forma errada é 400, sem ficha criada', () => {
  it.each([
    ['os objetos que o GET devolve', [{ id: ETIQUETA, name: 'Typebot', color: '#3b82f6' }]],
    ['texto misturado com objeto', ['Lead', { name: 'Typebot' }]],
    ['texto vazio', ['']],
    ['texto só de espaço', ['  ']],
    ['número', [7]],
    ['texto solto em vez de lista', 'Typebot'],
  ])('%s', async (_, tags) => {
    const res = await post({ phone: '+5511900000000', name: 'Maria Exemplo', tags });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: 'bad_request',
        message: "'tags' must be an array of non-empty strings (tag names or ids)",
      },
    });
    expect(helpers.lerTagsPedidas).not.toHaveBeenCalled();
    expect(helpers.resolveAuditUserId).not.toHaveBeenCalled();
    expect(helpers.findOrCreateContact).not.toHaveBeenCalled();
    expect(helpers.setContactTags).not.toHaveBeenCalled();
    expect(helpers.from).not.toHaveBeenCalled();
  });

  it('lista de nomes e ids passa adiante intacta', async () => {
    const res = await post({ phone: '+5511900000000', tags: ['Typebot', ETIQUETA] });
    expect(res.status).toBe(200);
    expect(helpers.lerTagsPedidas).toHaveBeenCalledWith(expect.anything(), 'conta-1', ['Typebot', ETIQUETA]);
    expect(helpers.setContactTags).toHaveBeenCalledTimes(1);
  });

  it('sem `tags`, as etiquetas não são tocadas', async () => {
    const res = await post({ phone: '+5511900000000' });
    expect(res.status).toBe(200);
    expect(helpers.lerTagsPedidas).not.toHaveBeenCalled();
    expect(helpers.setContactTags).not.toHaveBeenCalled();
  });

  it('`tags: null` também não toca as etiquetas, como sempre foi', async () => {
    const res = await post({ phone: '+5511900000000', tags: null });
    expect(res.status).toBe(200);
    expect(helpers.lerTagsPedidas).not.toHaveBeenCalled();
    expect(helpers.setContactTags).not.toHaveBeenCalled();
  });
});
