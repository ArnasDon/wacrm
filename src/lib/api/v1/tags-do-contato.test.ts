import { describe, expect, it, vi, beforeEach } from 'vitest';

import { chaveDeTag } from '@/lib/contacts/chave-de-tag';

import {
  aplicarMudancaDeTags,
  casarReferencias,
  lerMudancaDeTags,
  MAX_TAGS_POR_CHAMADA,
  TagReferenceError,
} from './tags-do-contato';

// Ids fictícios, na forma de uuid — é a forma que decide "isto é um id".
const ID_BANCARIO = '11111111-1111-4111-8111-111111111111';
const ID_TYPEBOT = '33333333-3333-4333-8333-333333333333';
const ID_NOVA = '55555555-5555-4555-8555-555555555555';
const ID_DE_OUTRA_CONTA = '99999999-9999-4999-8999-999999999999';

/** O catálogo como `lerCatalogoDeTags` o devolve: por chave (a mais antiga vence) e por id. */
function catalogoDe(tags: { id: string; name: string }[]) {
  const porChave = new Map<string, string>();
  const nomePorId = new Map<string, string>();
  for (const t of tags) {
    nomePorId.set(t.id.toLowerCase(), t.name);
    if (!porChave.has(chaveDeTag(t.name))) porChave.set(chaveDeTag(t.name), t.id);
  }
  return { porChave, nomePorId };
}

const resolveImportTagIds = vi.hoisted(() => vi.fn());
const lerCatalogoDeTags = vi.hoisted(() => vi.fn());
const addContactTagAndDispatch = vi.hoisted(() => vi.fn());
const removeContactTag = vi.hoisted(() => vi.fn());

vi.mock('@/lib/contacts/resolve-import-tags', () => ({
  resolveImportTagIds,
  lerCatalogoDeTags,
}));
vi.mock('@/lib/contacts/tag-events', () => ({ addContactTagAndDispatch }));
vi.mock('@/lib/contacts/tag-write', () => ({
  removeContactTag,
  // A classe de erro é usada pelo módulo sob teste; sem ela no mock, o
  // `throw` vira erro do vitest e o teste mede a coisa errada.
  ContactTagWriteError: class ContactTagWriteError extends Error {
    readonly status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.name = 'ContactTagWriteError';
      this.status = status;
    }
  },
}));

describe('lerMudancaDeTags', () => {
  it('aceita só add, só remove, e os dois juntos', () => {
    expect(lerMudancaDeTags({ add: ['VIP'] })).toEqual({
      ok: true,
      mudanca: { add: ['VIP'], remove: [], criarFaltantes: true },
    });
    expect(lerMudancaDeTags({ remove: ['VIP'] })).toEqual({
      ok: true,
      mudanca: { add: [], remove: ['VIP'], criarFaltantes: true },
    });
    const dois = lerMudancaDeTags({ add: ['A'], remove: ['B'] });
    expect(dois.ok).toBe(true);
  });

  it('apara e deduplica sem diferenciar maiúscula', () => {
    const r = lerMudancaDeTags({ add: ['  VIP  ', 'vip', 'Vip', 'Outra'] });
    expect(r.ok && r.mudanca.add).toEqual(['VIP', 'Outra']);
  });

  it('RECUSA o mesmo nome em add e remove — o resultado dependeria da ordem', () => {
    const r = lerMudancaDeTags({ add: ['VIP'], remove: ['vip'] });
    expect(r).toEqual({
      ok: false,
      erro: "the same tag cannot be in both 'add' and 'remove': vip",
    });
  });

  it('⚠️ a recusa usa a MESMA régua da resolução — acento incluído', () => {
    // Regressão: enquanto a validação usava só `toLowerCase()` e a
    // resolução usava `chaveDeTag()` (que também tira acento),
    // {add:["Bancário"], remove:["bancario"]} PASSAVA pela recusa. Na
    // aplicação, o remove tirava a etiqueta e o add reinseria a MESMA —
    // disparando `tag_added`, que pode mandar mensagem ao cliente por uma
    // etiqueta que ele já tinha antes e continua tendo depois.
    const r = lerMudancaDeTags({ add: ['Bancário'], remove: ['bancario'] });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erro).toContain('cannot be in both');
  });

  it('⚠️ a deduplicação também ignora acento', () => {
    // `["Bancário", "bancario"]` resolve para a MESMA etiqueta; sobreviver
    // como dois nomes fazia o segundo sair como "inalterada", relatando uma
    // mudança que não houve.
    const r = lerMudancaDeTags({ add: ['Bancário', 'bancario', 'BANCARIO'] });
    expect(r.ok && r.mudanca.add).toEqual(['Bancário']);
  });

  it('recusa corpo que não é objeto', () => {
    for (const cru of [null, 'x', 42, ['VIP']]) {
      expect(lerMudancaDeTags(cru).ok).toBe(false);
    }
  });

  it('recusa lista vazia dos dois lados — não haveria o que fazer', () => {
    expect(lerMudancaDeTags({}).ok).toBe(false);
    expect(lerMudancaDeTags({ add: [], remove: [] }).ok).toBe(false);
  });

  it('recusa nome vazio, elemento não-string e lista que não é array', () => {
    expect(lerMudancaDeTags({ add: ['  '] }).ok).toBe(false);
    expect(lerMudancaDeTags({ add: [1] }).ok).toBe(false);
    expect(lerMudancaDeTags({ add: 'VIP' }).ok).toBe(false);
  });

  it('recusa acima do teto', () => {
    const muitas = Array.from(
      { length: MAX_TAGS_POR_CHAMADA + 1 },
      (_, i) => `t${i}`
    );
    expect(lerMudancaDeTags({ add: muitas }).ok).toBe(false);
  });

  it('create_missing só aceita booleano, e o padrão é criar', () => {
    expect(lerMudancaDeTags({ add: ['A'], create_missing: 'sim' }).ok).toBe(
      false
    );
    const off = lerMudancaDeTags({ add: ['A'], create_missing: false });
    expect(off.ok && off.mudanca.criarFaltantes).toBe(false);
    const on = lerMudancaDeTags({ add: ['A'] });
    expect(on.ok && on.mudanca.criarFaltantes).toBe(true);
  });
});

/**
 * A leitura do catálogo é o `lerCatalogoDeTags` (mockado), então o "banco"
 * aqui só precisa existir — nenhuma consulta passa por ele.
 */
function bancoCom(
  tags: { id: string; name: string }[],
  opts: { falha?: boolean } = {}
) {
  if (opts.falha) {
    lerCatalogoDeTags.mockRejectedValue(new Error('timeout'));
  } else {
    // O real chega ordenado por `created_at` e deixa a PRIMEIRA (a mais
    // antiga) vencer a colisão de chave — `catalogoDe` imita isso, e é o que
    // o teste da colisão mede.
    lerCatalogoDeTags.mockResolvedValue(catalogoDe(tags));
  }
  return {} as never;
}

describe('aplicarMudancaDeTags', () => {
  const base = {
    accountId: 'conta-1',
    auditUserId: 'dono-1',
    contactId: 'contato-1',
  };
  const CATALOGO = [
    { id: ID_BANCARIO, name: 'Bancário' },
    { id: ID_TYPEBOT, name: 'Typebot' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('⚠️ nome SEM acento acha a etiqueta COM acento — não cria outra', () => {
    // O caso que motivou a régua própria. É assíncrono; a asserção vem no
    // teste seguinte, este só fixa o formato do catálogo.
    expect(chaveDeTag(CATALOGO[0].name)).toBe('bancario');
  });

  it('acrescenta sem tocar nas outras, e sem criar duplicata por acento', async () => {
    addContactTagAndDispatch.mockResolvedValue({
      added: true,
      dispatched: true,
    });

    const r = await aplicarMudancaDeTags(bancoCom(CATALOGO), {
      ...base,
      mudanca: { add: ['bancario'], remove: [], criarFaltantes: true },
    });

    // O balde leva o nome GRAVADO, não a grafia enviada.
    expect(r.adicionadas).toEqual(['Bancário']);
    expect(r.desconhecidas).toEqual([]);
    // NADA foi criado: o casamento achou a etiqueta que já existia.
    expect(resolveImportTagIds).not.toHaveBeenCalled();
    expect(addContactTagAndDispatch).toHaveBeenCalledWith({
      db: expect.anything(),
      accountId: 'conta-1',
      contactId: 'contato-1',
      tagId: ID_BANCARIO,
    });
  });

  it('etiqueta já aplicada vira "inalterada" e NÃO dispara o gatilho', async () => {
    // `added: false` é o 23505 agindo dentro do helper.
    addContactTagAndDispatch.mockResolvedValue({
      added: false,
      dispatched: false,
      reason: 'duplicate',
    });

    const r = await aplicarMudancaDeTags(bancoCom(CATALOGO), {
      ...base,
      mudanca: { add: ['Typebot'], remove: [], criarFaltantes: true },
    });

    expect(r.adicionadas).toEqual([]);
    expect(r.inalteradas).toEqual(['Typebot']);
  });

  it('⚠️ confia no mapa do helper — é lá que a corrida converge', async () => {
    // A criação conflict-safe e a releitura moram em `resolveImportTagIds`
    // desde a 983, para que as TRÊS portas herdem. Aqui basta provar que
    // este chamador usa o id que o helper devolve, e não um que ele mesmo
    // tivesse guardado antes da criação.
    resolveImportTagIds.mockResolvedValue({
      tagIdByKey: new Map([
        ['nova', ID_NOVA],
        ['bancario', ID_BANCARIO],
      ]),
      nomePorId: new Map([
        [ID_NOVA, 'Nova'],
        [ID_BANCARIO, 'Bancário'],
      ]),
      skippedNames: [],
    });
    addContactTagAndDispatch.mockResolvedValue({
      added: true,
      dispatched: true,
    });

    await aplicarMudancaDeTags(bancoCom(CATALOGO), {
      ...base,
      mudanca: { add: ['Nova'], remove: [], criarFaltantes: true },
    });

    expect(addContactTagAndDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ tagId: ID_NOVA })
    );
  });

  it('nome novo de verdade é criado pelo helper compartilhado', async () => {
    resolveImportTagIds.mockResolvedValue({
      tagIdByKey: new Map([['nova', ID_NOVA]]),
      nomePorId: new Map([[ID_NOVA, 'Nova']]),
      skippedNames: [],
    });
    addContactTagAndDispatch.mockResolvedValue({
      added: true,
      dispatched: true,
    });

    const r = await aplicarMudancaDeTags(bancoCom(CATALOGO), {
      ...base,
      mudanca: { add: ['Nova'], remove: [], criarFaltantes: true },
    });

    expect(resolveImportTagIds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tagNames: ['Nova'], canCreateTags: true })
    );
    expect(r.adicionadas).toEqual(['Nova']);
  });

  it('create_missing:false não cria nada e reporta desconhecida', async () => {
    const r = await aplicarMudancaDeTags(bancoCom(CATALOGO), {
      ...base,
      mudanca: { add: ['Nova'], remove: [], criarFaltantes: false },
    });

    expect(resolveImportTagIds).not.toHaveBeenCalled();
    expect(r.desconhecidas).toEqual(['Nova']);
    expect(addContactTagAndDispatch).not.toHaveBeenCalled();
  });

  it('distingue etiqueta retirada de etiqueta que não estava aplicada', async () => {
    removeContactTag.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const r = await aplicarMudancaDeTags(bancoCom(CATALOGO), {
      ...base,
      mudanca: {
        add: [],
        remove: ['Typebot', 'bancario'],
        criarFaltantes: true,
      },
    });

    expect(r.removidas).toEqual(['Typebot']);
    expect(r.inalteradas).toEqual(['Bancário']);
  });

  it('⚠️ REMOVER nunca cria etiqueta, mesmo com create_missing ligado', async () => {
    const r = await aplicarMudancaDeTags(bancoCom(CATALOGO), {
      ...base,
      mudanca: { add: [], remove: ['Fantasma'], criarFaltantes: true },
    });

    expect(resolveImportTagIds).not.toHaveBeenCalled();
    expect(removeContactTag).not.toHaveBeenCalled();
    expect(r.desconhecidas).toEqual(['Fantasma']);
  });

  it('⚠️ na colisão de chave vence a etiqueta MAIS ANTIGA', async () => {
    // O catálogo chega ordenado por `created_at`; a primeira ocorrência é a
    // que o escritório vem usando. Sem isso a escolha mudaria entre duas
    // chamadas iguais.
    addContactTagAndDispatch.mockResolvedValue({
      added: true,
      dispatched: true,
    });
    const ANTIGA = '66666666-6666-4666-8666-666666666666';
    const RECENTE = '77777777-7777-4777-8777-777777777777';
    const comColisao = [
      { id: ANTIGA, name: 'Bancário' },
      { id: RECENTE, name: 'bancario' },
    ];

    await aplicarMudancaDeTags(bancoCom(comColisao), {
      ...base,
      mudanca: { add: ['BANCARIO'], remove: [], criarFaltantes: true },
    });

    expect(addContactTagAndDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ tagId: ANTIGA })
    );
  });

  it('falha ao ler o catálogo ESTOURA — não vira "desconhecida"', async () => {
    // Tratar erro de banco como "essa etiqueta não existe" faria a API
    // responder 200 dizendo que o nome é desconhecido, e o integrador
    // recriaria a etiqueta.
    await expect(
      aplicarMudancaDeTags(bancoCom([], { falha: true }), {
        ...base,
        mudanca: { add: ['Typebot'], remove: [], criarFaltantes: true },
      })
    ).rejects.toThrow(/tags/i);
  });
});

// ============================================================
// NOME ou ID (22/09/2026). O caso real: um integrador pegou o `id` do
// "Typebot" em GET /api/v1/tags e o mandou onde a API lia NOME; ela criou
// uma etiqueta chamada com o UUID, aplicou-a e disparou `tag_added`.
// ============================================================

describe('casarReferencias', () => {
  const CATALOGO = catalogoDe([
    { id: ID_BANCARIO, name: 'Bancário' },
    { id: ID_TYPEBOT, name: 'Typebot' },
  ]);

  it('id da conta vira a etiqueta, com o nome GRAVADO', () => {
    expect(casarReferencias([ID_TYPEBOT], CATALOGO)).toEqual({
      itens: [{ pedido: ID_TYPEBOT, id: ID_TYPEBOT, nome: 'Typebot' }],
      idsDesconhecidos: [],
    });
  });

  it('nome casa sem acento e sem caixa, e também devolve o nome gravado', () => {
    expect(casarReferencias(['  bancario '], CATALOGO).itens).toEqual([
      { pedido: 'bancario', id: ID_BANCARIO, nome: 'Bancário' },
    ]);
  });

  it('nome que não existe fica sem id — candidato a criação', () => {
    expect(casarReferencias(['Nova'], CATALOGO).itens).toEqual([
      { pedido: 'Nova', id: null, nome: 'Nova' },
    ]);
  });

  it('⚠️⚠️ id de fora NUNCA vira nome a criar — vai para idsDesconhecidos', () => {
    const r = casarReferencias([ID_DE_OUTRA_CONTA, ID_DE_OUTRA_CONTA], CATALOGO);
    expect(r.itens).toEqual([]);
    expect(r.idsDesconhecidos).toEqual([ID_DE_OUTRA_CONTA]);
  });

  it('⚠️ nome e id da MESMA etiqueta são UMA — a primeira ocorrência fica', () => {
    const r = casarReferencias(
      ['Typebot', ID_TYPEBOT.toUpperCase(), 'TYPEBOT'],
      CATALOGO
    );
    expect(r.itens).toEqual([
      { pedido: 'Typebot', id: ID_TYPEBOT, nome: 'Typebot' },
    ]);
  });

  it('ignora texto vazio (o parse já recusa; o PATCH filtra só não-string)', () => {
    expect(casarReferencias(['  ', ''], CATALOGO)).toEqual({
      itens: [],
      idsDesconhecidos: [],
    });
  });
});

describe('aplicarMudancaDeTags — por id', () => {
  const base = {
    accountId: 'conta-1',
    auditUserId: 'dono-1',
    contactId: 'contato-1',
  };
  const CATALOGO = [
    { id: ID_BANCARIO, name: 'Bancário' },
    { id: ID_TYPEBOT, name: 'Typebot' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    addContactTagAndDispatch.mockResolvedValue({ added: true, dispatched: true });
    removeContactTag.mockResolvedValue(true);
  });

  it('⚠️⚠️ acrescenta pelo id SEM criar nada — o caso de 22/09', async () => {
    const r = await aplicarMudancaDeTags(bancoCom(CATALOGO), {
      ...base,
      mudanca: { add: [ID_TYPEBOT], remove: [], criarFaltantes: true },
    });

    expect(resolveImportTagIds).not.toHaveBeenCalled();
    expect(addContactTagAndDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ tagId: ID_TYPEBOT })
    );
    // O integrador lê "Typebot", nunca o UUID cru.
    expect(r).toEqual({
      adicionadas: ['Typebot'],
      removidas: [],
      inalteradas: [],
      desconhecidas: [],
    });
  });

  it('retira pelo id, e o balde leva o nome', async () => {
    const r = await aplicarMudancaDeTags(bancoCom(CATALOGO), {
      ...base,
      mudanca: { add: [], remove: [ID_BANCARIO], criarFaltantes: true },
    });

    expect(removeContactTag).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tagId: ID_BANCARIO })
    );
    expect(r.removidas).toEqual(['Bancário']);
  });

  it('⚠️⚠️ id que não é desta conta: 400 unknown_tag_ids e NADA escrito', async () => {
    // O id desconhecido está no `add`, mas o `remove` válido vem primeiro na
    // aplicação — a recusa tem de acontecer antes dele.
    const erro = await aplicarMudancaDeTags(bancoCom(CATALOGO), {
      ...base,
      mudanca: {
        add: ['Nova', ID_DE_OUTRA_CONTA],
        remove: ['Bancário'],
        criarFaltantes: true,
      },
    }).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(TagReferenceError);
    expect((erro as TagReferenceError).code).toBe('unknown_tag_ids');
    expect((erro as TagReferenceError).status).toBe(400);
    expect((erro as TagReferenceError).message).toContain(ID_DE_OUTRA_CONTA);
    expect(removeContactTag).not.toHaveBeenCalled();
    expect(addContactTagAndDispatch).not.toHaveBeenCalled();
    // …nem a criação do nome válido que vinha junto.
    expect(resolveImportTagIds).not.toHaveBeenCalled();
  });

  it('⚠️ id desconhecido no REMOVE também é 400 (não "desconhecida")', async () => {
    await expect(
      aplicarMudancaDeTags(bancoCom(CATALOGO), {
        ...base,
        mudanca: { add: [], remove: [ID_DE_OUTRA_CONTA], criarFaltantes: true },
      })
    ).rejects.toMatchObject({ code: 'unknown_tag_ids', status: 400 });
    expect(removeContactTag).not.toHaveBeenCalled();
  });

  it('⚠️⚠️ texto com cara de UUID NUNCA é criado, mesmo com create_missing', async () => {
    // É exatamente o que aconteceu em produção: o id de uma etiqueta que
    // não está no catálogo desta conta seria lido como NOME e criado.
    await expect(
      aplicarMudancaDeTags(bancoCom(CATALOGO), {
        ...base,
        mudanca: { add: [ID_NOVA], remove: [], criarFaltantes: true },
      })
    ).rejects.toBeInstanceOf(TagReferenceError);
    expect(resolveImportTagIds).not.toHaveBeenCalled();
    expect(addContactTagAndDispatch).not.toHaveBeenCalled();
  });

  it('⚠️ nome e id da MESMA etiqueta no add: aplicada e relatada UMA vez', async () => {
    const r = await aplicarMudancaDeTags(bancoCom(CATALOGO), {
      ...base,
      mudanca: {
        add: ['typebot', ID_TYPEBOT],
        remove: [],
        criarFaltantes: true,
      },
    });

    expect(addContactTagAndDispatch).toHaveBeenCalledTimes(1);
    expect(r.adicionadas).toEqual(['Typebot']);
  });

  it('⚠️⚠️ a mesma etiqueta por NOME num lado e por ID no outro é recusada — antes de escrever', async () => {
    // O parse não vê (os textos são diferentes); sem esta recusa, o remove
    // tirava a etiqueta e o add a punha de volta, disparando `tag_added`.
    const leitura = lerMudancaDeTags({ add: ['Typebot'], remove: [ID_TYPEBOT] });
    expect(leitura.ok).toBe(true);

    const erro = await aplicarMudancaDeTags(bancoCom(CATALOGO), {
      ...base,
      mudanca: leitura.ok ? leitura.mudanca : (null as never),
    }).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(TagReferenceError);
    expect((erro as TagReferenceError).code).toBe('bad_request');
    expect((erro as TagReferenceError).message).toContain(
      "cannot be in both 'add' and 'remove': Typebot"
    );
    expect(removeContactTag).not.toHaveBeenCalled();
    expect(addContactTagAndDispatch).not.toHaveBeenCalled();
  });

  it('mistura nome novo, nome existente e id: cada um no seu balde', async () => {
    resolveImportTagIds.mockResolvedValue({
      tagIdByKey: new Map([
        ['nova', ID_NOVA],
        ['bancario', ID_BANCARIO],
        ['typebot', ID_TYPEBOT],
      ]),
      nomePorId: new Map([
        [ID_NOVA, 'Nova'],
        [ID_BANCARIO, 'Bancário'],
        [ID_TYPEBOT, 'Typebot'],
      ]),
      skippedNames: [],
    });
    addContactTagAndDispatch
      .mockResolvedValueOnce({ added: true, dispatched: true })
      .mockResolvedValueOnce({ added: false, dispatched: false, reason: 'duplicate' })
      .mockResolvedValueOnce({ added: true, dispatched: true });

    const r = await aplicarMudancaDeTags(bancoCom(CATALOGO), {
      ...base,
      mudanca: {
        add: ['nova', 'bancario', ID_TYPEBOT],
        remove: [],
        criarFaltantes: true,
      },
    });

    // Só o nome que não existia vai à criação — nunca o id.
    expect(resolveImportTagIds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tagNames: ['nova'] })
    );
    expect(r.adicionadas).toEqual(['Nova', 'Typebot']);
    expect(r.inalteradas).toEqual(['Bancário']);
  });
});

describe('lerMudancaDeTags — com id', () => {
  it('aceita id no add e no remove, como texto', () => {
    const r = lerMudancaDeTags({ add: [ID_TYPEBOT], remove: ['Bancário'] });
    expect(r).toEqual({
      ok: true,
      mudanca: { add: [ID_TYPEBOT], remove: ['Bancário'], criarFaltantes: true },
    });
  });

  it('o mesmo id nos dois lados (mesmo com caixa diferente) é recusado já no parse', () => {
    const r = lerMudancaDeTags({
      add: [ID_TYPEBOT],
      remove: [ID_TYPEBOT.toUpperCase()],
    });
    expect(r.ok).toBe(false);
  });
});
