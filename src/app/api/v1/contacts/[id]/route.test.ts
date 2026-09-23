import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// GET/PATCH /api/v1/contacts/{id} — a entrada é recusada ANTES de tocar no
// banco. Dois defeitos, os dois com cara de resposta certa:
//
//   1. `tags` com item que não é texto era FILTRADO em silêncio. O GET desta
//      rota devolve `tags` como objetos `{ id, name, color }`; o integrador
//      que devolvia a ficha como a leu mandava uma lista só de objetos, ela
//      virava lista VAZIA, e o PATCH — que SUBSTITUI o conjunto — apagava
//      todas as etiquetas do contato, com 200.
//   2. `{id}` malformado chegava cru ao `.eq('id', …)`: o Postgres recusava
//      (22P02) e a resposta era 500 — que cliente HTTP retenta.
//
// O banco aqui GRITA se for tocado, e os helpers de contato são espiões: o
// pino é "400 e NENHUMA consulta, NENHUMA escrita".
// ============================================================

const helpers = vi.hoisted(() => ({
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
  getContactById: helpers.getContactById,
  lerTagsPedidas: helpers.lerTagsPedidas,
  setContactTags: helpers.setContactTags,
  resolveAuditUserId: helpers.resolveAuditUserId,
  ContactError: class ContactError extends Error {
    status = 500;
  },
}));
// O módulo real arrasta o motor de automações (via `tag-events`); aqui só a
// classe importa.
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

import { GET, PATCH } from './route';

const ID = '11111111-2222-4333-8444-555555555555';
const ETIQUETA = '0f0f0f0f-1111-4222-8333-444444444444';

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const patch = (id: string, corpo: unknown) =>
  PATCH(
    new Request(`http://localhost/api/v1/contacts/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
      body: JSON.stringify(corpo),
    }),
    params(id)
  );

const get = (id: string) =>
  GET(new Request(`http://localhost/api/v1/contacts/${id}`, { headers: { authorization: 'Bearer x' } }), params(id));

beforeEach(() => {
  for (const f of Object.values(helpers)) f.mockClear();
  helpers.getContactById.mockResolvedValue({ id: ID, tags: [] });
  helpers.lerTagsPedidas.mockResolvedValue({ ids: [ETIQUETA], nomesNovos: [] });
  helpers.setContactTags.mockResolvedValue(undefined);
  helpers.resolveAuditUserId.mockResolvedValue('usuario-de-auditoria');
});

function nadaFoiTocado() {
  expect(helpers.getContactById).not.toHaveBeenCalled();
  expect(helpers.lerTagsPedidas).not.toHaveBeenCalled();
  expect(helpers.setContactTags).not.toHaveBeenCalled();
  expect(helpers.from).not.toHaveBeenCalled();
}

describe('PATCH /api/v1/contacts/{id} — `tags` com forma errada é 400, sem escrita', () => {
  it.each([
    ['os objetos que o próprio GET devolve', [{ id: ETIQUETA, name: 'Typebot', color: '#3b82f6' }]],
    ['texto misturado com objeto', ['Lead', { id: ETIQUETA }]],
    ['texto vazio', ['']],
    ['texto só de espaço', ['Lead', '   ']],
    ['número', [42]],
    ['null dentro da lista', [null]],
    ['texto solto em vez de lista', 'Typebot'],
    ['objeto no lugar da lista', { add: ['Typebot'] }],
  ])('%s', async (_, tags) => {
    const res = await patch(ID, { name: 'Maria Exemplo', tags });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: 'bad_request',
        message: "'tags' must be an array of non-empty strings (tag names or ids)",
      },
    });
    // Nem o nome foi gravado: a recusa vem antes da primeira escrita.
    nadaFoiTocado();
  });

  it('lista de nomes e ids passa adiante intacta', async () => {
    const res = await patch(ID, { tags: ['Typebot', ETIQUETA] });
    expect(res.status).toBe(200);
    expect(helpers.lerTagsPedidas).toHaveBeenCalledWith(expect.anything(), 'conta-1', ['Typebot', ETIQUETA]);
    expect(helpers.setContactTags).toHaveBeenCalledTimes(1);
  });

  it('`tags: []` continua sendo "tirar todas" — por escrito, não por acidente', async () => {
    const res = await patch(ID, { tags: [] });
    expect(res.status).toBe(200);
    expect(helpers.lerTagsPedidas).toHaveBeenCalledWith(expect.anything(), 'conta-1', []);
    expect(helpers.setContactTags).toHaveBeenCalledTimes(1);
  });

  it('`tags: null` é "não mexer", como sempre foi — recusá-lo quebraria quem já manda o campo nulo', async () => {
    helpers.getContactById.mockResolvedValue({ id: ID });
    const res = await patch(ID, { tags: null });
    expect(res.status).toBe(200);
    expect(helpers.lerTagsPedidas).not.toHaveBeenCalled();
    expect(helpers.setContactTags).not.toHaveBeenCalled();
  });

  it('sem `tags` no corpo, as etiquetas não são tocadas', async () => {
    helpers.getContactById.mockResolvedValue({ id: ID });
    const res = await PATCH(
      new Request(`http://localhost/api/v1/contacts/${ID}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      params(ID)
    );
    expect(res.status).toBe(200);
    expect(helpers.lerTagsPedidas).not.toHaveBeenCalled();
    expect(helpers.setContactTags).not.toHaveBeenCalled();
  });
});

describe('`{id}` que não é UUID é 400, nunca o 500 do 22P02', () => {
  it.each(['abc', '123', `${ID}x`, 'not-a-uuid-at-all-0000000000000000'])('GET %s', async (id) => {
    const res = await get(id);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: 'bad_request', message: "'id' must be a UUID" } });
    nadaFoiTocado();
  });

  it.each(['abc', '123'])('PATCH %s', async (id) => {
    const res = await patch(id, { name: 'Maria Exemplo' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: 'bad_request', message: "'id' must be a UUID" } });
    nadaFoiTocado();
  });

  it('UUID bem formado segue para a leitura', async () => {
    const res = await get(ID);
    expect(res.status).toBe(200);
    expect(helpers.getContactById).toHaveBeenCalledWith(expect.anything(), 'conta-1', ID);
  });
});
