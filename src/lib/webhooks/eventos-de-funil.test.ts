import { describe, expect, it } from 'vitest';

import type { ApiDeal } from '@/lib/api/v1/deals';
import type { DealEventContact } from './dados-dos-eventos';
import {
  eventoDaLinha,
  montarAviso,
  origemDoAviso,
  type CatalogoDoAviso,
  type LinhaDaFila,
} from './eventos-de-funil';

// ============================================================
// Linha da fila do funil → aviso de webhook. Dados FICTÍCIOS.
// ============================================================

const FUNIL_A = '00000000-0000-4000-8000-00000000f00a';
const FUNIL_B = '00000000-0000-4000-8000-00000000f00b';
const ETAPA_LEAD = '00000000-0000-4000-8000-0000000e7a01';
const ETAPA_REUNIAO = '00000000-0000-4000-8000-0000000e7a02';
const ETAPA_OUTRO_FUNIL = '00000000-0000-4000-8000-0000000e7a03';
const NEGOCIO = '00000000-0000-4000-8000-0000000de410';
const CONTATO = '00000000-0000-4000-8000-0000000c0e70';
const CONEXAO = '00000000-0000-4000-8000-0000000c0e40';

function linha(parcial: Partial<LinhaDaFila> = {}): LinhaDaFila {
  return {
    id: 'evt-1',
    tipo: 'deal_stage_changed',
    deal_id: NEGOCIO,
    contact_id: CONTATO,
    channel_id: CONEXAO,
    from_pipeline_id: FUNIL_A,
    to_pipeline_id: FUNIL_A,
    from_stage_id: ETAPA_LEAD,
    to_stage_id: ETAPA_REUNIAO,
    from_status: null,
    to_status: null,
    origem: 'usuario',
    criado_em: '2026-09-23T14:05:00.000Z',
    ...parcial,
  };
}

const NEGOCIO_HOJE: ApiDeal = {
  id: NEGOCIO,
  pipeline_id: FUNIL_B,
  // ⚠️ O negócio JÁ andou de novo depois do evento: está noutra etapa.
  stage_id: ETAPA_OUTRO_FUNIL,
  contact_id: CONTATO,
  conversation_id: null,
  channel_id: CONEXAO,
  title: 'Maria Exemplo',
  value: 1500,
  currency: 'BRL',
  status: 'open',
  source: 'manual',
  expected_close_date: null,
  created_at: '2026-09-20T12:00:00.000Z',
  updated_at: '2026-09-23T14:06:00.000Z',
};

const CONTATO_COMPLETO: DealEventContact = {
  id: CONTATO,
  phone: '5511900000000',
  name: 'Maria Exemplo',
  email: 'maria@exemplo.com.br',
  company: null,
  avatar_url: null,
  instagram_id: null,
  instagram_username: null,
  tags: [{ id: 't1', name: 'Typebot', color: '#3b82f6' }],
  created_at: '2026-09-20T12:00:00.000Z',
  updated_at: '2026-09-23T14:05:00.000Z',
  custom_fields: { tamanho_da_divida: '150000', utm_source: null },
};

function catalogo(parcial: Partial<CatalogoDoAviso> = {}): CatalogoDoAviso {
  return {
    negocios: new Map([[NEGOCIO, NEGOCIO_HOJE]]),
    responsaveis: new Map([[NEGOCIO, { user_id: 'u-ana', name: 'Ana Atendente' }]]),
    funis: new Map([
      [FUNIL_A, 'Comercial'],
      [FUNIL_B, 'Jurídico'],
    ]),
    etapas: new Map([
      [ETAPA_LEAD, { name: 'Lead', position: 2 }],
      [ETAPA_REUNIAO, { name: 'Reunião Agendada', position: 3 }],
      [ETAPA_OUTRO_FUNIL, { name: 'Triagem', position: 0 }],
    ]),
    contatos: new Map([[CONTATO, CONTATO_COMPLETO]]),
    ...parcial,
  };
}

describe('eventoDaLinha', () => {
  it('INSERT de card (sem "de onde") é deal.created — a fila o grava como mudança de etapa', () => {
    expect(
      eventoDaLinha({ tipo: 'deal_stage_changed', from_pipeline_id: null, from_stage_id: null })
    ).toBe('deal.created');
  });

  it('mudança de etapa no mesmo funil é deal.stage_changed', () => {
    expect(eventoDaLinha(linha())).toBe('deal.stage_changed');
  });

  it('troca de FUNIL também é deal.stage_changed (a fila grava as duas como etapa)', () => {
    expect(
      eventoDaLinha(linha({ from_pipeline_id: FUNIL_A, to_pipeline_id: FUNIL_B, to_stage_id: ETAPA_OUTRO_FUNIL }))
    ).toBe('deal.stage_changed');
  });

  it('mudança de status é deal.status_changed — mesmo com o "de onde" de etapa vazio', () => {
    // A fila grava o status SEM from_pipeline/from_stage; o tipo decide antes.
    expect(
      eventoDaLinha({ tipo: 'deal_status_changed', from_pipeline_id: null, from_stage_id: null })
    ).toBe('deal.status_changed');
  });
});

describe('origemDoAviso', () => {
  it('traduz o vocabulário da fila para o da API pública', () => {
    expect(origemDoAviso('usuario')).toBe('user');
    expect(origemDoAviso('conexao')).toBe('channel');
    expect(origemDoAviso('automacao')).toBe('automation');
    expect(origemDoAviso('sistema')).toBe('system');
  });

  it('valor desconhecido (coluna futura) vira system, nunca undefined', () => {
    expect(origemDoAviso('outra' as LinhaDaFila['origem'])).toBe('system');
  });
});

describe('montarAviso', () => {
  it('o id e a hora são os do FATO; a origem vem traduzida', () => {
    const { data } = montarAviso(linha({ id: 'evt-42', origem: 'conexao' }), catalogo());
    expect(data.event_id).toBe('evt-42');
    expect(data.occurred_at).toBe('2026-09-23T14:05:00.000Z');
    expect(data.source).toBe('channel');
    expect(data.channel_id).toBe(CONEXAO);
  });

  it('⚠️ `stage`/`pipeline` vêm do EVENTO, não do negócio (que já andou)', () => {
    const { evento, data } = montarAviso(linha(), catalogo());
    expect(evento).toBe('deal.stage_changed');
    expect(data.stage).toEqual({ id: ETAPA_REUNIAO, name: 'Reunião Agendada', position: 3 });
    expect(data.pipeline).toEqual({ id: FUNIL_A, name: 'Comercial' });
    // O negócio é a foto da HORA DO ENVIO — outra etapa, e não é bug.
    expect(data.deal?.stage_id).toBe(ETAPA_OUTRO_FUNIL);
  });

  it('deal.stage_changed leva from_pipeline/from_stage; não leva status', () => {
    const aviso = montarAviso(
      linha({ to_pipeline_id: FUNIL_B, to_stage_id: ETAPA_OUTRO_FUNIL }),
      catalogo()
    );
    expect(aviso.evento).toBe('deal.stage_changed');
    if (aviso.evento !== 'deal.stage_changed') throw new Error('evento errado');
    expect(aviso.data.from_pipeline).toEqual({ id: FUNIL_A, name: 'Comercial' });
    expect(aviso.data.from_stage).toEqual({ id: ETAPA_LEAD, name: 'Lead', position: 2 });
    expect(aviso.data.pipeline).toEqual({ id: FUNIL_B, name: 'Jurídico' });
    expect('status' in aviso.data).toBe(false);
    expect('from_status' in aviso.data).toBe(false);
  });

  it('deal.created NÃO leva from_* nem status', () => {
    const aviso = montarAviso(
      linha({ from_pipeline_id: null, from_stage_id: null, to_stage_id: ETAPA_LEAD, origem: 'conexao' }),
      catalogo()
    );
    expect(aviso.evento).toBe('deal.created');
    for (const campo of ['from_pipeline', 'from_stage', 'from_status', 'status']) {
      expect(campo in aviso.data).toBe(false);
    }
    expect(aviso.data.stage).toEqual({ id: ETAPA_LEAD, name: 'Lead', position: 2 });
  });

  it('deal.status_changed leva from_status/status; NÃO leva from_pipeline/from_stage', () => {
    const aviso = montarAviso(
      linha({
        tipo: 'deal_status_changed',
        from_pipeline_id: null,
        from_stage_id: null,
        from_status: 'open',
        to_status: 'won',
      }),
      catalogo()
    );
    expect(aviso.evento).toBe('deal.status_changed');
    if (aviso.evento !== 'deal.status_changed') throw new Error('evento errado');
    expect(aviso.data.from_status).toBe('open');
    expect(aviso.data.status).toBe('won');
    expect('from_pipeline' in aviso.data).toBe(false);
    expect('from_stage' in aviso.data).toBe(false);
    // A etapa em que o card estava quando mudou de status.
    expect(aviso.data.stage?.id).toBe(ETAPA_REUNIAO);
  });

  it('leva o contato completo — etiquetas e campos personalizados — e o responsável', () => {
    const { data } = montarAviso(linha(), catalogo());
    expect(data.contact).toEqual(CONTATO_COMPLETO);
    expect(data.contact?.tags.map((t) => t.name)).toEqual(['Typebot']);
    expect(data.contact?.custom_fields).toEqual({ tamanho_da_divida: '150000', utm_source: null });
    expect(data.assignee).toEqual({ user_id: 'u-ana', name: 'Ana Atendente' });
  });

  describe('o que foi APAGADO antes da entrega vira null (e só isso)', () => {
    it('negócio apagado: deal e assignee null, deal_id preservado', () => {
      const { data } = montarAviso(linha(), catalogo({ negocios: new Map(), responsaveis: new Map() }));
      expect(data.deal_id).toBe(NEGOCIO);
      expect(data.deal).toBeNull();
      expect(data.assignee).toBeNull();
    });

    it('contato apagado: contact null', () => {
      expect(montarAviso(linha(), catalogo({ contatos: new Map() })).data.contact).toBeNull();
    });

    it('linha sem contato (grupo, ou SET NULL): contact null sem consultar o catálogo', () => {
      expect(montarAviso(linha({ contact_id: null }), catalogo()).data.contact).toBeNull();
    });

    it('etapa/funil apagados: o id fica, o nome e a posição viram null', () => {
      const aviso = montarAviso(linha(), catalogo({ funis: new Map(), etapas: new Map() }));
      expect(aviso.data.stage).toEqual({ id: ETAPA_REUNIAO, name: null, position: null });
      expect(aviso.data.pipeline).toEqual({ id: FUNIL_A, name: null });
      if (aviso.evento !== 'deal.stage_changed') throw new Error('evento errado');
      expect(aviso.data.from_stage).toEqual({ id: ETAPA_LEAD, name: null, position: null });
    });

    it('card sem negócio na linha (deal_id nulo): deal e assignee null', () => {
      const { data } = montarAviso(linha({ deal_id: null }), catalogo());
      expect(data.deal_id).toBeNull();
      expect(data.deal).toBeNull();
      expect(data.assignee).toBeNull();
    });
  });
});
