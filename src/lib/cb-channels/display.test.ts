import { describe, expect, it } from 'vitest';

import {
  channelLabel,
  channelsUsingPipeline,
  channelsUsingStage,
  findChannel,
  formatChannelPhone,
  metaChannels,
  preferredChannel,
  summarizeScope,
} from './display';
import type { CbChannel } from './repo';

function canal(over: Partial<CbChannel> & { id: string }): CbChannel {
  return {
    account_id: 'acc',
    kind: 'meta',
    label: over.id,
    display_phone: null,
    is_default: false,
    status: 'connected',
    connected_at: null,
    last_error: null,
    phone_number_id: null,
    waba_id: null,
    server_url: null,
    instance_name: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  } as CbChannel;
}

const comercial = canal({ id: 'c1', label: 'Comercial', is_default: true });
const juridico = canal({ id: 'c2', label: 'Jurídico' });
const pessoal = canal({ id: 'c3', label: 'Pessoal', kind: 'evolution' });
const lista = [comercial, juridico, pessoal];

describe('formatChannelPhone', () => {
  it('formata os dígitos crus da Evolution', () => {
    expect(formatChannelPhone('5511987654321')).toBe('+55 (11) 98765-4321');
  });

  it('aceita fixo de 8 dígitos', () => {
    expect(formatChannelPhone('551133334444')).toBe('+55 (11) 3333-4444');
  });

  it('não mexe no que a Meta já entregou formatado', () => {
    expect(formatChannelPhone('+55 11 98765-4321')).toBe('+55 11 98765-4321');
  });

  it('número estrangeiro cru só ganha o +', () => {
    expect(formatChannelPhone('14155552671')).toBe('+14155552671');
  });

  it('nulo e vazio devolvem null', () => {
    expect(formatChannelPhone(null)).toBeNull();
    expect(formatChannelPhone('')).toBeNull();
  });
});

describe('findChannel / channelLabel', () => {
  it('acha pelo id', () => {
    expect(findChannel(lista, 'c2')?.label).toBe('Jurídico');
    expect(channelLabel(lista, 'c2')).toBe('Jurídico');
  });

  it('id ausente ou desconhecido devolve null (não inventa rótulo)', () => {
    expect(channelLabel(lista, null)).toBeNull();
    expect(channelLabel(lista, 'sumiu')).toBeNull();
  });
});

describe('summarizeScope', () => {
  // A REGRA que este arquivo existe para travar: vazio = TODOS.
  it('null, undefined e array vazio significam TODOS os canais', () => {
    expect(summarizeScope(lista, null)).toEqual({ kind: 'all' });
    expect(summarizeScope(lista, undefined)).toEqual({ kind: 'all' });
    expect(summarizeScope(lista, [])).toEqual({ kind: 'all' });
  });

  it('um id resolve para o rótulo daquele canal', () => {
    expect(summarizeScope(lista, ['c1'])).toEqual({ kind: 'one', label: 'Comercial' });
  });

  it('aceita string solta (o formato dos flows)', () => {
    expect(summarizeScope(lista, 'c2')).toEqual({ kind: 'one', label: 'Jurídico' });
  });

  it('vários ids viram contagem + rótulos', () => {
    expect(summarizeScope(lista, ['c1', 'c3'])).toEqual({
      kind: 'many',
      count: 2,
      labels: ['Comercial', 'Pessoal'],
    });
  });

  it('ids que não resolvem são descartados da contagem', () => {
    // Canal apagado no meio: o que sobra ainda é um escopo de 1, não de 2.
    expect(summarizeScope(lista, ['c1', 'apagado'])).toEqual({
      kind: 'one',
      label: 'Comercial',
    });
  });

  it('escopo cheio de ids mortos é "unresolved", nunca "all"', () => {
    // Se isto virasse 'all', a tela diria "dispara em todos os números"
    // sobre uma automação restrita — a mentira mais cara possível aqui.
    expect(summarizeScope(lista, ['x', 'y'])).toEqual({ kind: 'unresolved', count: 2 });
  });

  it('lista de canais ainda vazia (carregando) não vira "all"', () => {
    expect(summarizeScope([], ['c1'])).toEqual({ kind: 'unresolved', count: 1 });
    expect(summarizeScope([], null)).toEqual({ kind: 'all' });
  });
});

describe('metaChannels', () => {
  it('deixa passar só os oficiais', () => {
    expect(metaChannels(lista).map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('conta só com Evolution devolve vazio', () => {
    expect(metaChannels([pessoal])).toEqual([]);
  });
});

describe('preferredChannel', () => {
  it('o padrão da conta ganha', () => {
    expect(preferredChannel(lista)?.id).toBe('c1');
  });

  it('sem padrão entre os elegíveis, o primeiro conectado', () => {
    const desconectado = canal({ id: 'd', status: 'disconnected' });
    expect(preferredChannel([desconectado, juridico])?.id).toBe('c2');
  });

  it('nenhum conectado: cai no primeiro da lista em vez de sumir', () => {
    const a = canal({ id: 'a', status: 'disconnected' });
    const b = canal({ id: 'b', status: 'connecting' });
    expect(preferredChannel([a, b])?.id).toBe('a');
  });

  it('lista vazia devolve null', () => {
    expect(preferredChannel([])).toBeNull();
  });
});

describe('channelsUsingPipeline / channelsUsingStage', () => {
  const canais = [
    canal({ id: 'trabalhista', default_pipeline_id: 'f1', default_stage_id: 'e-lead' }),
    canal({ id: 'bancario', default_pipeline_id: 'f2', default_stage_id: 'e-novo' }),
    canal({ id: 'sem-funil' }),
  ];

  it('acha as conexões que apontam para o funil', () => {
    expect(channelsUsingPipeline(canais, 'f1').map((c) => c.id)).toEqual(['trabalhista']);
  });

  it('funil que ninguém usa devolve vazio', () => {
    expect(channelsUsingPipeline(canais, 'f9')).toEqual([]);
  });

  it('id nulo devolve vazio em vez de casar com conexão sem funil', () => {
    // `default_pipeline_id` é NULL na maioria das conexões. Sem esta guarda,
    // um id ausente casaria com TODAS elas e a tela acusaria dependência
    // onde não há nenhuma.
    expect(channelsUsingPipeline(canais, null)).toEqual([]);
    expect(channelsUsingStage(canais, undefined)).toEqual([]);
  });

  it('acha as conexões que entram por aquela etapa', () => {
    expect(channelsUsingStage(canais, 'e-lead').map((c) => c.id)).toEqual(['trabalhista']);
  });
});

describe('identidadeDoCanal', () => {
  it('WhatsApp mostra o telefone formatado; Instagram, o @', async () => {
    const { identidadeDoCanal } = await import('./display');
    expect(
      identidadeDoCanal({ kind: 'evolution', display_phone: '5583980000016', ig_username: null }),
    ).toBe('+55 (83) 98000-0016');
    expect(
      identidadeDoCanal({ kind: 'meta', display_phone: '+55 83 9800-0016', ig_username: null }),
    ).toBe('+55 83 9800-0016');
    expect(
      identidadeDoCanal({ kind: 'instagram', display_phone: null, ig_username: 'cbadv.bancario' }),
    ).toBe('@cbadv.bancario');
  });

  it('sem identidade ainda, devolve null nos dois transportes', async () => {
    const { identidadeDoCanal } = await import('./display');
    expect(identidadeDoCanal({ kind: 'evolution', display_phone: null, ig_username: null })).toBeNull();
    // Instagram sem @ não existe na prática (o /me sempre traz), mas o tipo
    // permite — e um "@null" na tela seria pior que o travessão.
    expect(identidadeDoCanal({ kind: 'instagram', display_phone: null, ig_username: null })).toBeNull();
  });
});
