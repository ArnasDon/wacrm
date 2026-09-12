import { describe, expect, it } from 'vitest';
import { ATRASO_CRITICO_MS, ATRASO_DE_RESPOSTA_MS } from '@/lib/inbox/atraso';
import type { ContextoDeAcesso, PerfilDeAcesso } from '@/lib/perfis/tipos';
import type { Conversation } from '@/types';
import {
  TETO_DE_ITENS,
  conversasEsperando,
  limitar,
  resumirConversas,
  resumirFila,
} from './contagens';

const AGORA = Date.parse('2026-09-12T12:00:00Z');
const min = (n: number) => n * 60_000;

/** Um contexto de agent com recorte de conexões (vazio = todas). */
function ctxComCanais(channel_ids: string[]): ContextoDeAcesso {
  const perfil = {
    id: 'p1',
    account_id: 'a1',
    nome: 'Advogado',
    papel_base: 'agent',
    telas: ['inbox'],
    secoes_config: [],
    channel_ids,
    pipeline_ids: [],
  } as unknown as PerfilDeAcesso;
  return { papel: 'agent', perfil };
}

const DONO: ContextoDeAcesso = { papel: 'owner', perfil: null };

let seq = 0;
function conversa(
  extra: Partial<Conversation> & { esperaMin?: number | null }
): Conversation {
  const { esperaMin, ...resto } = extra;
  seq++;
  return {
    id: `c${seq}`,
    user_id: 'u',
    contact_id: `ct${seq}`,
    status: 'open',
    unread_count: 0,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    aguardando_desde:
      esperaMin === null || esperaMin === undefined
        ? null
        : new Date(AGORA - min(esperaMin)).toISOString(),
    ...resto,
  } as Conversation;
}

describe('resumirConversas (as atribuídas à pessoa)', () => {
  it('9 min não conta, 10 conta, 30 é crítico; encerrada e sem espera ficam fora de "esperando"', () => {
    const r = resumirConversas(
      [
        conversa({ esperaMin: 9 }),
        conversa({ esperaMin: 10 }),
        conversa({ esperaMin: 30 }),
        conversa({ esperaMin: 45, status: 'closed' }),
        conversa({ esperaMin: null }),
      ],
      DONO,
      AGORA
    );
    expect(r.atribuidas).toBe(4);
    expect(r.foraDoPerfil).toBe(0);
    expect(
      r.esperando.map((e) => [e.atraso.n, e.atraso.unidade, e.atraso.critico])
    ).toEqual([
      [30, 'min', true],
      [10, 'min', false],
    ]);
    expect(ATRASO_DE_RESPOSTA_MS).toBe(min(10));
    expect(ATRASO_CRITICO_MS).toBe(min(30));
  });

  it('grupo entra no total mas nunca em "esperando" (a régua da caixa de entrada)', () => {
    const r = resumirConversas(
      [
        conversa({ group_id: 'g1', contact_id: null, esperaMin: 60 }),
        conversa({ esperaMin: 60 }),
      ],
      DONO,
      AGORA
    );
    expect(r.atribuidas).toBe(2);
    expect(r.esperando).toHaveLength(1);
    expect(r.esperando[0].conversa.group_id).toBeUndefined();
  });

  it('conversa num número fora do perfil é contada à parte e não entra em "esperando"', () => {
    const ctx = ctxComCanais(['canal-A']);
    const r = resumirConversas(
      [
        conversa({ channel_id: 'canal-A', esperaMin: 20 }),
        conversa({ channel_id: 'canal-B', esperaMin: 20 }),
        conversa({ channel_id: null, esperaMin: 20 }), // sem carimbo: passa (conversaNoEscopo)
      ],
      ctx,
      AGORA
    );
    expect(r.atribuidas).toBe(2);
    expect(r.foraDoPerfil).toBe(1);
    expect(r.esperando.map((e) => e.conversa.channel_id)).toEqual([
      'canal-A',
      null,
    ]);
  });

  it('grupo é recortado pelo canal do GRUPO (cb_groups.channel_id), nunca pela coluna da conversa', () => {
    const ctx = ctxComCanais(['canal-A']);
    const dentro = conversa({
      group_id: 'g1',
      contact_id: null,
      channel_id: null,
      group: { channel_id: 'canal-A' } as Conversation['group'],
    });
    const fora = conversa({
      group_id: 'g2',
      contact_id: null,
      channel_id: null,
      group: { channel_id: 'canal-B' } as Conversation['group'],
    });
    const r = resumirConversas([dentro, fora], ctx, AGORA);
    expect(r.atribuidas).toBe(1);
    expect(r.foraDoPerfil).toBe(1);
  });
});

describe('conversasEsperando (a consulta própria das "esperando")', () => {
  it('só o escopo, só quem espera 10 min ou mais, mais antiga primeiro; encerrada e grupo fora', () => {
    const ctx = ctxComCanais(['canal-A']);
    const r = conversasEsperando(
      [
        conversa({ channel_id: 'canal-A', esperaMin: 12 }),
        conversa({ channel_id: 'canal-A', esperaMin: 90 }),
        conversa({ channel_id: 'canal-B', esperaMin: 90 }),
        conversa({ channel_id: 'canal-A', esperaMin: 90, status: 'closed' }),
        conversa({
          group_id: 'g',
          contact_id: null,
          channel_id: null,
          esperaMin: 90,
        }),
        conversa({ channel_id: 'canal-A', esperaMin: 4 }),
      ],
      ctx,
      AGORA
    );
    expect(r.map((e) => [e.atraso.n, e.atraso.unidade])).toEqual([
      [1, 'h'],
      [12, 'min'],
    ]);
  });
});

describe('resumirFila (sem responsável)', () => {
  const desde = AGORA - min(120);

  it('reparte pelo instante da última confirmação e diz a espera mais longa', () => {
    const r = resumirFila(
      [
        conversa({ esperaMin: 15 }), // nova (começou depois de `desde`)
        conversa({ esperaMin: 60 }), // nova
        conversa({ esperaMin: 200 }), // antiga
        conversa({ esperaMin: 3 * 24 * 60 }), // antiga, a mais longa
        conversa({ esperaMin: 5 }), // ainda não conta (menos de 10 min)
        conversa({ esperaMin: 500, status: 'closed' }),
        conversa({ esperaMin: 500, assigned_agent_id: 'alguem' }),
        conversa({ esperaMin: null }),
      ],
      DONO,
      AGORA,
      desde
    );
    expect(r.novas.map((e) => e.atraso.n)).toEqual([1, 15]); // 1 h, depois 15 min: mais antiga primeiro
    expect(r.novas.map((e) => e.atraso.unidade)).toEqual(['h', 'min']);
    expect(r.antigas).toBe(2);
    expect(r.maisAntiga).toEqual({ n: 3, unidade: 'd', critico: true });
  });

  it('respeita o recorte do perfil e ignora grupo', () => {
    const ctx = ctxComCanais(['canal-A']);
    const r = resumirFila(
      [
        conversa({ channel_id: 'canal-A', esperaMin: 30 }),
        conversa({ channel_id: 'canal-B', esperaMin: 30 }),
        conversa({ group_id: 'g', contact_id: null, esperaMin: 30 }),
      ],
      ctx,
      AGORA,
      desde
    );
    expect(r.novas).toHaveLength(1);
    expect(r.antigas).toBe(0);
    expect(r.novas[0].conversa.channel_id).toBe('canal-A');
  });

  it('fila vazia: nada e sem espera mais longa', () => {
    expect(resumirFila([], DONO, AGORA, desde)).toEqual({
      novas: [],
      antigas: 0,
      maisAntiga: null,
    });
  });
});

describe('limitar', () => {
  it('corta no teto e conta o resto', () => {
    expect(limitar([1, 2, 3, 4, 5, 6, 7])).toEqual({
      itens: [1, 2, 3, 4, 5],
      restantes: 2,
    });
    expect(limitar([1, 2], 5)).toEqual({ itens: [1, 2], restantes: 0 });
    expect(limitar([])).toEqual({ itens: [], restantes: 0 });
    expect(TETO_DE_ITENS).toBe(5);
  });
});
