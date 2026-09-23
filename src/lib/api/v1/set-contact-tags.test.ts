import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chaveDeTag } from '@/lib/contacts/chave-de-tag';

import { lerTagsPedidas, setContactTags, type TagsPedidas } from './contacts';
import { TagReferenceError } from './tags-do-contato';

// ============================================================
// `PATCH /api/v1/contacts/{id}` (e `POST /api/v1/contacts`) com `tags: [...]`
// SUBSTITUI o conjunto. Este caminho não tinha teste, e escondia um defeito
// antigo: `resolveImportTagIds` devolve o CATÁLOGO INTEIRO chaveado por nome
// (o import de CSV consulta esse mapa linha a linha), e `setContactTags`
// tomava os `values()` como "as desejadas" — aplicando TODAS as etiquetas da
// conta ao contato.
//
// Só apareceu na verificação e2e da 983: até então `contact_tags` estava
// zerada em produção e não havia chave de API ativa, então o caminho nunca
// rodou com etiqueta de verdade.
//
// Desde 22/09/2026 são DUAS fases: `lerTagsPedidas` (só leitura: nome OU id,
// id desconhecido = 400) e `setContactTags` (escreve). O caso que motivou:
// um integrador mandou o ID do "Typebot" num PATCH, a API criou uma etiqueta
// chamada com o UUID e tirou o "Typebot" que o contato tinha.
// ============================================================

const resolveImportTagIds = vi.hoisted(() => vi.fn());
const lerCatalogoDeTags = vi.hoisted(() => vi.fn());
const addContactTagAndDispatch = vi.hoisted(() => vi.fn());

vi.mock('@/lib/contacts/resolve-import-tags', () => ({
  resolveImportTagIds,
  lerCatalogoDeTags,
}));
vi.mock('@/lib/contacts/tag-events', () => ({ addContactTagAndDispatch }));

// Ids fictícios, na forma de uuid — é a forma que decide "isto é um id".
const ID_BANCARIO = '11111111-1111-4111-8111-111111111111';
const ID_TRABALHISTA = '22222222-2222-4222-8222-222222222222';
const ID_TYPEBOT = '33333333-3333-4333-8333-333333333333';
const ID_DEMITIDA = '44444444-4444-4444-8444-444444444444';
const ID_DE_OUTRA_CONTA = '99999999-9999-4999-8999-999999999999';

/** Catálogo com QUATRO etiquetas; os testes pedem uma ou duas. */
const ETIQUETAS = [
  { id: ID_BANCARIO, name: 'Bancário' },
  { id: ID_TRABALHISTA, name: 'Trabalhista' },
  { id: ID_TYPEBOT, name: 'Typebot' },
  { id: ID_DEMITIDA, name: 'Demitida' },
];

function catalogo(tags = ETIQUETAS) {
  return {
    porChave: new Map(tags.map((t) => [chaveDeTag(t.name), t.id])),
    nomePorId: new Map(tags.map((t) => [t.id, t.name])),
  };
}

/** Client de mentira: a leitura dos vínculos atuais e as escritas. */
function bancoCom(atuais: string[]) {
  const registro = { apagados: [] as string[][], leituras: 0 };
  const db = {
    registro,
    from: () => ({
      select: () => ({
        eq: () => {
          registro.leituras++;
          return Promise.resolve({
            data: atuais.map((tag_id) => ({ tag_id })),
            error: null,
          });
        },
      }),
      delete: () => ({
        eq: () => ({
          in: (_coluna: string, ids: string[]) => {
            registro.apagados.push(ids);
            return Promise.resolve({ error: null });
          },
        }),
      }),
    }),
  };
  return db as never;
}

type Registro = { apagados: string[][]; leituras: number };
const registroDe = (db: never) =>
  (db as unknown as { registro: Registro }).registro;

/** As duas fases, na ordem em que as rotas as chamam. */
async function substituir(db: never, textos: string[]) {
  const pedidas = await lerTagsPedidas(db, 'conta-1', textos);
  await setContactTags(db, 'conta-1', 'dono-1', 'contato-1', pedidas);
}

describe('lerTagsPedidas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lerCatalogoDeTags.mockResolvedValue(catalogo());
  });

  it('casa nome SEM acento e separa o que ainda não existe', async () => {
    const r = await lerTagsPedidas({} as never, 'conta-1', ['bancario', 'Nova']);
    expect(r).toEqual({ ids: [ID_BANCARIO], nomesNovos: ['Nova'] });
  });

  it('⚠️ o id da etiqueta é lido como ID — nunca vira nome a criar', async () => {
    const r = await lerTagsPedidas({} as never, 'conta-1', [ID_TYPEBOT]);
    expect(r).toEqual({ ids: [ID_TYPEBOT], nomesNovos: [] });
  });

  it('id em maiúsculas e com espaço nas pontas continua sendo o mesmo id', async () => {
    const r = await lerTagsPedidas({} as never, 'conta-1', [
      `  ${ID_TYPEBOT.toUpperCase()} `,
    ]);
    expect(r.ids).toEqual([ID_TYPEBOT]);
  });

  it('⚠️ nome e id da MESMA etiqueta contam UMA vez', async () => {
    const r = await lerTagsPedidas({} as never, 'conta-1', [
      'Typebot',
      ID_TYPEBOT,
      'typebot',
    ]);
    expect(r).toEqual({ ids: [ID_TYPEBOT], nomesNovos: [] });
  });

  it('⚠️⚠️ id que não é desta conta é 400 unknown_tag_ids — e nada é criado', async () => {
    const erro = await lerTagsPedidas({} as never, 'conta-1', [
      'Bancário',
      ID_DE_OUTRA_CONTA,
    ]).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(TagReferenceError);
    expect((erro as TagReferenceError).code).toBe('unknown_tag_ids');
    expect((erro as TagReferenceError).status).toBe(400);
    expect((erro as TagReferenceError).message).toContain(ID_DE_OUTRA_CONTA);
    expect(resolveImportTagIds).not.toHaveBeenCalled();
  });

  it('falha ao ler o catálogo vira 500, não "etiqueta desconhecida"', async () => {
    lerCatalogoDeTags.mockRejectedValue(new Error('timeout'));
    await expect(
      lerTagsPedidas({} as never, 'conta-1', ['Bancário'])
    ).rejects.toMatchObject({ status: 500 });
  });
});

describe('setContactTags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lerCatalogoDeTags.mockResolvedValue(catalogo());
    resolveImportTagIds.mockResolvedValue({
      tagIdByKey: catalogo().porChave,
      nomePorId: catalogo().nomePorId,
      skippedNames: [],
    });
    addContactTagAndDispatch.mockResolvedValue({ added: true, dispatched: true });
  });

  it('⚠️ aplica SÓ as etiquetas pedidas, não o catálogo inteiro', async () => {
    const db = bancoCom([]);
    await substituir(db, ['Bancário']);

    expect(addContactTagAndDispatch).toHaveBeenCalledTimes(1);
    expect(addContactTagAndDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ tagId: ID_BANCARIO })
    );
  });

  it('casa SEM acento — "bancario" acha a "Bancário" do catálogo', async () => {
    const db = bancoCom([]);
    await substituir(db, ['bancario']);

    expect(addContactTagAndDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ tagId: ID_BANCARIO })
    );
    // Já existia: nada a criar.
    expect(resolveImportTagIds).not.toHaveBeenCalled();
  });

  it('SUBSTITUI: tira o que não foi pedido', async () => {
    const db = bancoCom([ID_TYPEBOT, ID_DEMITIDA]);
    await substituir(db, ['Bancário']);

    expect(registroDe(db).apagados[0].sort()).toEqual(
      [ID_DEMITIDA, ID_TYPEBOT].sort()
    );
    expect(addContactTagAndDispatch).toHaveBeenCalledTimes(1);
  });

  it('não mexe no que já estava certo', async () => {
    const db = bancoCom([ID_BANCARIO]);
    await substituir(db, ['Bancário']);

    expect(registroDe(db).apagados).toEqual([]);
    // Já aplicada: nada a acrescentar, e nenhum `tag_added` a disparar.
    expect(addContactTagAndDispatch).not.toHaveBeenCalled();
  });

  it('⚠️⚠️ PATCH com o ID da etiqueta MANTÉM a etiqueta — o caso de 22/09', async () => {
    // Antes: o id ia para a criação (virava uma etiqueta chamada com o
    // UUID) e, como não casava com a real, a real ia para `toRemove`.
    const db = bancoCom([ID_TYPEBOT, ID_DEMITIDA]);
    await substituir(db, [ID_TYPEBOT]);

    expect(resolveImportTagIds).not.toHaveBeenCalled();
    expect(registroDe(db).apagados).toEqual([[ID_DEMITIDA]]);
    expect(addContactTagAndDispatch).not.toHaveBeenCalled();
  });

  it('mistura de nome e id: cada etiqueta entra uma vez', async () => {
    const db = bancoCom([]);
    await substituir(db, ['Typebot', ID_TYPEBOT, ID_TRABALHISTA]);

    expect(addContactTagAndDispatch).toHaveBeenCalledTimes(2);
    const aplicadas = addContactTagAndDispatch.mock.calls.map(
      ([a]) => (a as { tagId: string }).tagId
    );
    expect(aplicadas.sort()).toEqual([ID_TRABALHISTA, ID_TYPEBOT].sort());
  });

  it('⚠️⚠️ id desconhecido: 400 ANTES de ler ou escrever o contato', async () => {
    const db = bancoCom([ID_TYPEBOT]);
    await expect(substituir(db, [ID_DE_OUTRA_CONTA])).rejects.toBeInstanceOf(
      TagReferenceError
    );

    const r = registroDe(db);
    expect(r.leituras).toBe(0);
    expect(r.apagados).toEqual([]);
    expect(addContactTagAndDispatch).not.toHaveBeenCalled();
    expect(resolveImportTagIds).not.toHaveBeenCalled();
  });

  it('nome novo de verdade é criado pelo helper compartilhado', async () => {
    resolveImportTagIds.mockResolvedValue({
      tagIdByKey: new Map([['nova', '55555555-5555-4555-8555-555555555555']]),
      nomePorId: new Map(),
      skippedNames: [],
    });
    const db = bancoCom([]);
    await substituir(db, ['Nova', 'Bancário']);

    expect(resolveImportTagIds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tagNames: ['Nova'], canCreateTags: true })
    );
    const aplicadas = addContactTagAndDispatch.mock.calls.map(
      ([a]) => (a as { tagId: string }).tagId
    );
    expect(aplicadas.sort()).toEqual(
      [ID_BANCARIO, '55555555-5555-4555-8555-555555555555'].sort()
    );
  });

  it('lista vazia limpa tudo', async () => {
    const db = bancoCom([ID_BANCARIO, ID_TYPEBOT]);
    await setContactTags(db, 'conta-1', 'dono-1', 'contato-1', {
      ids: [],
      nomesNovos: [],
    } satisfies TagsPedidas);

    expect(registroDe(db).apagados[0].sort()).toEqual(
      [ID_BANCARIO, ID_TYPEBOT].sort()
    );
  });

  it('⚠️⚠️ nome pedido que não resolveu ESTOURA — senão apagaria a etiqueta pedida', async () => {
    // Este verbo SUBSTITUI: o que não entra em `desired` entra em
    // `toRemove`. Ignorar um nome irresolvido em silêncio não é "aplicar
    // menos" — é APAGAR do contato justamente a etiqueta que o chamador
    // acabou de pedir para manter. (Achado da revisão adversarial.)
    resolveImportTagIds.mockResolvedValue({
      tagIdByKey: new Map(),
      nomePorId: new Map(),
      skippedNames: ['Nova'],
    });
    const db = bancoCom([ID_BANCARIO]);

    await expect(
      setContactTags(db, 'conta-1', 'dono-1', 'contato-1', {
        ids: [ID_BANCARIO],
        nomesNovos: ['Nova'],
      })
    ).rejects.toThrow(/Nova/);

    // e nada foi apagado no caminho
    expect(registroDe(db).apagados).toEqual([]);
  });
});
