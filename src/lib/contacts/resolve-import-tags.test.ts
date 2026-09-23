import { describe, expect, it } from 'vitest';

import {
  assignImportedContactTags,
  resolveImportTagIds,
} from './resolve-import-tags';

// ============================================================
// Este helper é a porta ÚNICA de criação de etiqueta: import de CSV,
// `PATCH /api/v1/contacts/{id}` e `POST .../tags` passam todos por aqui. Não
// tinha teste, e é onde a corrida do PR #150 morava.
// ============================================================

type Linha = { id: string; name: string };

/**
 * Client de mentira para o catálogo paginado + o upsert.
 *
 * `catalogos` é a sequência de respostas COMPLETAS da leitura — cada item é
 * o catálogo inteiro visto por uma chamada de `lerCatalogoDeTags`. O dublê
 * fatia cada um em páginas do mesmo tamanho que o código pede, e registra os
 * `range` recebidos, para dar como provar que a paginação acontece.
 */
function bancoCom(
  catalogos: Linha[][],
  opts: { erroAoCriar?: string; erroAoLer?: string } = {}
) {
  const registro = {
    leituras: 0,
    faixas: [] as [number, number][],
    upserts: [] as { linhas: Record<string, unknown>[]; opcoes: unknown }[],
  };
  let chamada = -1;

  const consulta = () => ({
    eq: () => ({
      order: () => ({
        order: () => ({
          range: (de: number, ate: number) => {
            if (opts.erroAoLer) {
              return Promise.resolve({
                data: null,
                error: { message: opts.erroAoLer },
              });
            }
            if (de === 0) chamada++;
            registro.leituras++;
            registro.faixas.push([de, ate]);
            const cat = catalogos[Math.min(chamada, catalogos.length - 1)];
            return Promise.resolve({
              data: cat.slice(de, ate + 1),
              error: null,
            });
          },
        }),
      }),
    }),
  });

  const db = {
    registro,
    from: () => ({
      select: consulta,
      upsert: (linhas: Record<string, unknown>[], opcoes: unknown) => {
        registro.upserts.push({ linhas, opcoes });
        return {
          select: () =>
            Promise.resolve(
              opts.erroAoCriar
                ? { data: null, error: { message: opts.erroAoCriar } }
                : { data: [], error: null }
            ),
        };
      },
    }),
  };
  return db as never;
}

const args = (tagNames: string[], canCreateTags = true) => ({
  accountId: 'conta-1',
  userId: 'dono-1',
  tagNames,
  canCreateTags,
});

const CATALOGO: Linha[] = [
  { id: 'id-bancario', name: 'Bancário' },
  { id: 'id-typebot', name: 'Typebot' },
];

describe('resolveImportTagIds', () => {
  it('⚠️ casa SEM acento — não cria uma segunda "bancario"', async () => {
    const db = bancoCom([CATALOGO]);
    const r = await resolveImportTagIds(db, args(['bancario']));

    expect(r.tagIdByKey.get('bancario')).toBe('id-bancario');
    expect(r.skippedNames).toEqual([]);
    expect((db as unknown as { registro: { upserts: unknown[] } }).registro.upserts).toEqual([]);
  });

  it('casa ignorando caixa', async () => {
    const db = bancoCom([CATALOGO]);
    const r = await resolveImportTagIds(db, args(['TYPEBOT']));
    expect(r.tagIdByKey.get('typebot')).toBe('id-typebot');
  });

  it('deduplica a entrada pela mesma chave', async () => {
    const db = bancoCom([CATALOGO, CATALOGO]);
    await resolveImportTagIds(db, args(['Nova', 'NOVA', 'nóva']));
    const { registro } = db as unknown as {
      registro: { upserts: { linhas: Record<string, unknown>[] }[] };
    };
    // Um nome só chega à criação, não três.
    expect(registro.upserts[0].linhas).toHaveLength(1);
  });

  it('⚠️ cria com ON CONFLICT DO NOTHING sobre o índice único da 983', async () => {
    // Ler-então-inserir deixava duas requisições concorrentes criarem as
    // DUAS. O árbitro é a coluna GERADA `name_key` — índice sobre expressão
    // não serviria, porque o `on_conflict` do PostgREST aceita nome de
    // coluna.
    const db = bancoCom([CATALOGO, [...CATALOGO, { id: 'id-nova', name: 'Nova' }]]);
    await resolveImportTagIds(db, args(['Nova']));

    const { registro } = db as unknown as {
      registro: { upserts: { opcoes: unknown }[] };
    };
    expect(registro.upserts[0].opcoes).toEqual({
      onConflict: 'account_id,name_key',
      ignoreDuplicates: true,
    });
  });

  it('⚠️ o id sai da RELEITURA, não do retorno do insert — é o que faz a corrida convergir', async () => {
    // Com `ignoreDuplicates`, quem perde a corrida recebe ZERO linhas de
    // volta. Se o id viesse do retorno, essa requisição ficaria sem etiqueta;
    // vindo da releitura, ela enxerga a que a OUTRA criou e as duas terminam
    // no mesmo id — uma linha em `contact_tags`, um disparo de `tag_added`.
    const db = bancoCom([
      CATALOGO, // antes
      [...CATALOGO, { id: 'id-da-outra-requisicao', name: 'Nova' }], // depois
    ]);
    const r = await resolveImportTagIds(db, args(['Nova']));

    expect(r.tagIdByKey.get('nova')).toBe('id-da-outra-requisicao');
    expect(r.skippedNames).toEqual([]);
  });

  it('sem permissão de criar, o nome novo volta em skippedNames', async () => {
    const db = bancoCom([CATALOGO]);
    const r = await resolveImportTagIds(db, args(['Nova'], false));

    expect(r.skippedNames).toEqual(['Nova']);
    expect((db as unknown as { registro: { upserts: unknown[] } }).registro.upserts).toEqual([]);
  });

  it('⚠️ releitura que não enxerga o que foi escrito vira "pulado", não mapa incompleto', async () => {
    // Devolver um mapa sem aquele nome, calado, faria o chamador atribuir
    // menos etiquetas do que pediu e não perceber.
    //
    // ⚠️ Isto NÃO é o caso de RLS: INSERT barrado por RLS ESTOURA (42501,
    // medido), e sai pelo `throw` do erro de criação. O que este ramo cobre
    // é a releitura não ver o que acabou de ser gravado — atraso de réplica,
    // ou alguém apagando entre as duas chamadas.
    const db = bancoCom([CATALOGO, CATALOGO]); // a releitura não traz a nova
    const r = await resolveImportTagIds(db, args(['Nova']));

    expect(r.skippedNames).toEqual(['Nova']);
    expect(r.tagIdByKey.has('nova')).toBe(false);
  });

  it('erro de banco na criação ESTOURA', async () => {
    const db = bancoCom([CATALOGO], { erroAoCriar: 'timeout' });
    await expect(resolveImportTagIds(db, args(['Nova']))).rejects.toBeTruthy();
  });

  it('lista vazia não toca no banco', async () => {
    const db = bancoCom([CATALOGO]);
    const r = await resolveImportTagIds(db, args([]));
    expect(r.tagIdByKey.size).toBe(0);
    expect((db as unknown as { registro: { leituras: number } }).registro.leituras).toBe(0);
  });

  it('⚠️ PAGINA o catálogo — o PostgREST corta em 1000 sem avisar', async () => {
    // Truncado, o mapa diz "não existe" sobre etiqueta que existe: criação
    // recusada pelo índice, ou "desconhecida" num remove que deveria achar.
    const grande: Linha[] = Array.from({ length: 1200 }, (_, i) => ({
      id: `id-${i}`,
      name: `Etiqueta ${i}`,
    }));
    const db = bancoCom([grande]);
    const r = await resolveImportTagIds(db, args(['Etiqueta 1100']));

    expect(r.tagIdByKey.get('etiqueta 1100')).toBe('id-1100');
    const { registro } = db as unknown as {
      registro: { faixas: [number, number][] };
    };
    expect(registro.faixas.length).toBeGreaterThan(1);
    expect(registro.faixas[0][0]).toBe(0);
    // a última página vem incompleta e encerra o laço
    expect(registro.faixas.length).toBe(3);
  });

  it('⚠️ erro na LEITURA do catálogo estoura — não vira "não existe"', async () => {
    // Tratar falha de leitura como catálogo vazio faria o código concluir
    // que toda etiqueta é nova e sair criando.
    const db = bancoCom([CATALOGO], { erroAoLer: 'timeout' });
    await expect(resolveImportTagIds(db, args(['Typebot']))).rejects.toBeTruthy();
  });

  it('⚠️⚠️ NUNCA cria etiqueta cujo nome tem formato de UUID — nem com permissão', async () => {
    // Caso de produção (22/09/2026): o id de uma etiqueta chegou onde se
    // esperava o nome, e a criação fez uma etiqueta NOVA chamada com o UUID.
    // As portas da API separam id de nome antes de chegar aqui; esta é a
    // segunda linha — vale também para o import de CSV.
    const uuid = '32f2da4f-765d-4be1-9496-eec52528c356';
    const db = bancoCom([CATALOGO, [...CATALOGO, { id: 'id-nova', name: 'Nova' }]]);
    const r = await resolveImportTagIds(db, args([uuid, 'Nova']));

    expect(r.skippedNames).toEqual([uuid]);
    const { registro } = db as unknown as {
      registro: { upserts: { linhas: Record<string, unknown>[] }[] };
    };
    // Só o nome de verdade chega à criação.
    expect(registro.upserts).toHaveLength(1);
    expect(registro.upserts[0].linhas.map((l) => l.name)).toEqual(['Nova']);
  });

  it('só UUID na lista: nem chega a tentar criar', async () => {
    const uuid = '32F2DA4F-765D-4BE1-9496-EEC52528C356';
    const db = bancoCom([CATALOGO]);
    const r = await resolveImportTagIds(db, args([uuid]));

    expect(r.skippedNames).toEqual([uuid]);
    expect((db as unknown as { registro: { upserts: unknown[] } }).registro.upserts).toEqual([]);
  });

  it('nome com cara de UUID que JÁ existe no catálogo continua casando', async () => {
    // Só a CRIAÇÃO é barrada: a etiqueta que alguém já criou com esse nome
    // (a de 22/09 ficou no catálogo) é uma etiqueta como outra qualquer.
    const uuid = '32f2da4f-765d-4be1-9496-eec52528c356';
    const db = bancoCom([[...CATALOGO, { id: 'id-da-etiqueta-uuid', name: uuid }]]);
    const r = await resolveImportTagIds(db, args([uuid]));

    expect(r.tagIdByKey.get(uuid)).toBe('id-da-etiqueta-uuid');
    expect(r.skippedNames).toEqual([]);
  });

  it('devolve também id → nome gravado, lido do catálogo depois da criação', async () => {
    const db = bancoCom([CATALOGO, [...CATALOGO, { id: 'ID-NOVA', name: 'Nova' }]]);
    const r = await resolveImportTagIds(db, args(['nova']));

    expect(r.nomePorId.get('id-bancario')).toBe('Bancário');
    // A chave do mapa é o id em minúsculas (o pedido é rebaixado antes).
    expect(r.nomePorId.get('id-nova')).toBe('Nova');
  });

  it('⚠️ na colisão de chave vence a MAIS ANTIGA (a leitura vem ordenada)', async () => {
    // Base anterior à 983 pode ter as duas: a migration RENOMEIA em vez de
    // apagar, para não quebrar referência em JSON de automação.
    const db = bancoCom([
      [
        { id: 'id-antiga', name: 'Bancário' },
        { id: 'id-nova', name: 'bancario' },
      ],
    ]);
    const r = await resolveImportTagIds(db, args(['BANCARIO']));
    expect(r.tagIdByKey.get('bancario')).toBe('id-antiga');
  });
});

// ============================================================
// `assignImportedContactTags` — o passo que grava os vínculos do import de
// CSV. Este PR trocou a derivação da chave (`name.trim().toLowerCase()` →
// `chaveDeTag`) e a função não tinha UM teste.
// ============================================================

/** Dublê só do upsert em `contact_tags`. */
function bancoDeVinculos(opts: { erro?: string } = {}) {
  const registro = { lotes: [] as Record<string, unknown>[][] };
  const db = {
    registro,
    from: () => ({
      upsert: (linhas: Record<string, unknown>[]) => {
        registro.lotes.push(linhas);
        return Promise.resolve(
          opts.erro ? { error: { message: opts.erro } } : { error: null }
        );
      },
    }),
  };
  return db as never;
}

describe('assignImportedContactTags', () => {
  const MAPA = new Map([
    ['bancario', 'id-bancario'],
    ['typebot', 'id-typebot'],
  ]);

  it('⚠️ consulta o mapa por chaveDeTag — o CSV traz o nome sem acento', () => {
    // Enquanto isto era `name.trim().toLowerCase()`, a chave montada aqui
    // não batia com a que `resolveImportTagIds` usa para MONTAR o mapa, e o
    // vínculo simplesmente não era criado: o import terminava "com sucesso"
    // e o contato ficava sem a etiqueta.
    const db = bancoDeVinculos();
    return assignImportedContactTags(
      db,
      [{ contactId: 'c1', tagNames: ['bancario', 'BANCÁRIO'] }],
      MAPA
    ).then(() => {
      const { registro } = db as unknown as {
        registro: { lotes: Record<string, unknown>[][] };
      };
      // as duas grafias são a MESMA etiqueta: um vínculo só
      expect(registro.lotes[0]).toEqual([
        { contact_id: 'c1', tag_id: 'id-bancario' },
      ]);
    });
  });

  it('nome fora do mapa é ignorado, não vira vínculo errado', async () => {
    const db = bancoDeVinculos();
    await assignImportedContactTags(
      db,
      [{ contactId: 'c1', tagNames: ['Fantasma'] }],
      MAPA
    );
    const { registro } = db as unknown as { registro: { lotes: unknown[] } };
    expect(registro.lotes).toEqual([]);
  });

  it('fatia em lotes — o teto de linhas do PostgREST vale aqui também', async () => {
    const db = bancoDeVinculos();
    const muitos = Array.from({ length: 250 }, (_, i) => ({
      contactId: `c${i}`,
      tagNames: ['Typebot'],
    }));
    await assignImportedContactTags(db, muitos, MAPA);
    const { registro } = db as unknown as {
      registro: { lotes: Record<string, unknown>[][] };
    };
    expect(registro.lotes.length).toBe(3);
    expect(registro.lotes[0].length).toBe(100);
    expect(registro.lotes[2].length).toBe(50);
  });

  it('erro de banco ESTOURA — import não pode terminar dizendo que deu certo', async () => {
    const db = bancoDeVinculos({ erro: 'timeout' });
    await expect(
      assignImportedContactTags(db, [{ contactId: 'c1', tagNames: ['Typebot'] }], MAPA)
    ).rejects.toBeTruthy();
  });

  it('lista vazia não toca no banco', async () => {
    const db = bancoDeVinculos();
    expect(await assignImportedContactTags(db, [], MAPA)).toBe(0);
    const { registro } = db as unknown as { registro: { lotes: unknown[] } };
    expect(registro.lotes).toEqual([]);
  });
});
