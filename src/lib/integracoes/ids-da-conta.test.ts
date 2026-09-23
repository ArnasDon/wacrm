import { describe, expect, it } from 'vitest';

import type { CbChannel } from '@/lib/cb-channels/repo';
import { agruparCampos } from '@/lib/contacts/grupos-de-campos';
import type { AccountMember, CustomField, GrupoDeCampos } from '@/types';

import {
  contaCasa,
  dadosDoBloco,
  filtrarBlocosDeCampos,
  filtrarConexoes,
  filtrarEtiquetas,
  filtrarFunis,
  filtrarMembros,
  montarFunis,
  montarJsonDosIds,
  normalizarBusca,
  type LinhaDeEtapa,
} from './ids-da-conta';

// Dados fictícios — nomes, números e e-mails que não são de ninguém.

const FUNIS = [
  { id: 'f-comercial', name: 'Comercial' },
  { id: 'f-juridico', name: 'Jurídico' },
];

const ETAPAS: LinhaDeEtapa[] = [
  { id: 'e-fechado', name: 'Contrato fechado', pipeline_id: 'f-comercial', position: 2, color: '#16a34a', resultado: 'ganho' },
  { id: 'e-lead', name: 'Lead', pipeline_id: 'f-comercial', position: 0, color: null, resultado: null },
  { id: 'e-perdido', name: 'Perdido', pipeline_id: 'f-comercial', position: 3, color: null, resultado: 'perdido' },
  { id: 'e-reuniao', name: 'Reunião', pipeline_id: 'f-comercial', position: 1, color: null, resultado: null },
  { id: 'e-peticao', name: 'Petição', pipeline_id: 'f-juridico', position: 0, color: null, resultado: 'qualquer' },
  { id: 'e-orfa', name: 'Órfã', pipeline_id: 'f-apagado', position: 0, color: null, resultado: null },
];

function campo(parcial: Partial<CustomField> & Pick<CustomField, 'id' | 'field_name' | 'field_key'>): CustomField {
  return {
    user_id: 'u-dono',
    account_id: 'conta-1',
    field_type: 'text',
    categoria: 'geral',
    grupo_id: null,
    posicao: null,
    created_at: '2026-01-01T00:00:00Z',
    ...parcial,
  };
}

const GRUPOS: GrupoDeCampos[] = [
  { id: 'g-bancario', account_id: 'conta-1', nome: 'Bancário', posicao: 0, created_at: '2026-01-01T00:00:00Z' },
];

const CAMPOS: CustomField[] = [
  campo({ id: 'c-email', field_name: 'E-mail', field_key: 'email' }),
  campo({ id: 'c-divida', field_name: 'Tamanho da dívida', field_key: 'tamanho_da_divida', field_type: 'number', grupo_id: 'g-bancario', posicao: 0 }),
  campo({ id: 'c-banco', field_name: 'Banco', field_key: 'banco', grupo_id: 'g-bancario', posicao: 1 }),
];

function canal(parcial: Partial<CbChannel> & Pick<CbChannel, 'id' | 'label' | 'kind'>): CbChannel {
  return {
    account_id: 'conta-1',
    display_phone: null,
    is_default: false,
    status: 'connected',
    connected_at: null,
    last_error: null,
    phone_number_id: null,
    waba_id: null,
    server_url: null,
    instance_name: null,
    default_pipeline_id: null,
    default_stage_id: null,
    groups_enabled: false,
    radar_enabled: false,
    ig_user_id: null,
    ig_username: null,
    ig_token_expires_at: null,
    ig_human_agent: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...parcial,
  };
}

const CANAIS: CbChannel[] = [
  canal({ id: 'ch-oficial', label: 'Atendimento', kind: 'meta', display_phone: '+55 11 90000-0001', is_default: true }),
  canal({ id: 'ch-qr', label: 'Comercial', kind: 'evolution', display_phone: '5511900000002' }),
  canal({ id: 'ch-ig', label: 'Instagram do escritório', kind: 'instagram', ig_username: 'escritorio_exemplo' }),
];

const MEMBROS: AccountMember[] = [
  { user_id: 'u-ana', full_name: 'Ana Exemplo', email: 'ana@exemplo.test', avatar_url: null, role: 'admin', joined_at: '2026-01-01T00:00:00Z' },
  { user_id: 'u-bruno', full_name: 'Bruno Teste', email: null, avatar_url: null, role: 'agent', joined_at: '2026-01-02T00:00:00Z' },
];

describe('montarFunis', () => {
  const funis = montarFunis(FUNIS, ETAPAS);

  it('pendura as etapas no funil de cada uma, na ordem do quadro', () => {
    expect(funis.map((f) => f.nome)).toEqual(['Comercial', 'Jurídico']);
    expect(funis[0].etapas.map((e) => e.nome)).toEqual([
      'Lead',
      'Reunião',
      'Contrato fechado',
      'Perdido',
    ]);
    // `ordem` é 1, 2, 3… mesmo com `position` começando em 0.
    expect(funis[0].etapas.map((e) => e.ordem)).toEqual([1, 2, 3, 4]);
  });

  it('descarta a etapa de funil que não veio na lista', () => {
    expect(funis.flatMap((f) => f.etapas).some((e) => e.id === 'e-orfa')).toBe(false);
  });

  it('só aceita ganho/perdido como resultado', () => {
    const porId = new Map(funis.flatMap((f) => f.etapas).map((e) => [e.id, e.resultado]));
    expect(porId.get('e-fechado')).toBe('ganho');
    expect(porId.get('e-perdido')).toBe('perdido');
    expect(porId.get('e-peticao')).toBeNull();
    expect(porId.get('e-lead')).toBeNull();
  });

  it('desempata posição repetida pelo nome', () => {
    const [f] = montarFunis(
      [{ id: 'f', name: 'F' }],
      [
        { id: 'b', name: 'Beta', pipeline_id: 'f', position: 0, color: null, resultado: null },
        { id: 'a', name: 'Alfa', pipeline_id: 'f', position: 0, color: null, resultado: null },
      ],
    );
    expect(f.etapas.map((e) => e.nome)).toEqual(['Alfa', 'Beta']);
  });
});

describe('normalizarBusca', () => {
  it('apara, põe em minúsculas e tira o acento', () => {
    expect(normalizarBusca('  Jurídico ')).toBe('juridico');
  });

  it('não esvazia a agulha com acento solto', () => {
    // `\p{Diacritic}` apagaria o `^` e a agulha vazia casaria com tudo.
    expect(normalizarBusca('^^')).toBe('^^');
  });
});

describe('a busca', () => {
  const funis = montarFunis(FUNIS, ETAPAS);

  it('sem termo, devolve tudo', () => {
    expect(filtrarFunis(funis, '')).toBe(funis);
    expect(filtrarConexoes(CANAIS, '')).toBe(CANAIS);
  });

  it('funil que casa aparece inteiro', () => {
    const r = filtrarFunis(funis, normalizarBusca('juridico'));
    expect(r).toHaveLength(1);
    expect(r[0].etapas.map((e) => e.nome)).toEqual(['Petição']);
    expect(filtrarFunis(funis, normalizarBusca('Comercial'))[0].etapas).toHaveLength(4);
  });

  it('etapa que casa aparece debaixo do funil dela, sem as irmãs', () => {
    const r = filtrarFunis(funis, normalizarBusca('reuniao'));
    expect(r.map((f) => f.nome)).toEqual(['Comercial']);
    expect(r[0].etapas.map((e) => e.nome)).toEqual(['Reunião']);
    // E continua dizendo que é a 2ª do quadro — a ordem vem de antes da busca.
    expect(r[0].etapas[0].ordem).toBe(2);
  });

  it('acha pelo id', () => {
    expect(filtrarFunis(funis, normalizarBusca('e-lead'))[0].etapas.map((e) => e.id)).toEqual([
      'e-lead',
    ]);
    expect(filtrarMembros(MEMBROS, 'u-bruno').map((m) => m.full_name)).toEqual(['Bruno Teste']);
    expect(contaCasa({ id: 'conta-1', nome: 'Escritório Exemplo' }, 'conta-1')).toBe(true);
    expect(contaCasa({ id: 'conta-1', nome: null }, 'outra')).toBe(false);
  });

  it('etiqueta casa pelo nome sem acento', () => {
    const etiquetas = [
      { id: 't1', nome: 'Bancário', cor: '#000' },
      { id: 't2', nome: 'Trabalhista', cor: null },
    ];
    expect(filtrarEtiquetas(etiquetas, normalizarBusca('bancario')).map((e) => e.id)).toEqual([
      't1',
    ]);
  });

  it('campo casa pela CHAVE, e o bloco que casa pelo nome aparece inteiro', () => {
    const blocos = agruparCampos(CAMPOS, GRUPOS);
    const pelaChave = filtrarBlocosDeCampos(blocos, normalizarBusca('tamanho_da'), 'Geral');
    expect(pelaChave).toHaveLength(1);
    expect(pelaChave[0].campos.map((c) => c.field_key)).toEqual(['tamanho_da_divida']);

    const peloBloco = filtrarBlocosDeCampos(blocos, normalizarBusca('bancario'), 'Geral');
    expect(peloBloco[0].campos).toHaveLength(2);

    // O "Geral" não tem linha no banco: é pelo rótulo do dicionário que a
    // busca o acha.
    const geral = filtrarBlocosDeCampos(blocos, normalizarBusca('geral'), 'Geral');
    expect(geral).toHaveLength(1);
    expect(geral[0].grupo).toBeNull();
  });

  it('conexão casa pelo número formatado, pelo cru e pelo @', () => {
    expect(filtrarConexoes(CANAIS, normalizarBusca('(11) 90000-0002')).map((c) => c.id)).toEqual([
      'ch-qr',
    ]);
    expect(filtrarConexoes(CANAIS, '5511900000002').map((c) => c.id)).toEqual(['ch-qr']);
    expect(filtrarConexoes(CANAIS, normalizarBusca('@escritorio')).map((c) => c.id)).toEqual([
      'ch-ig',
    ]);
  });

  it('membro casa pelo e-mail', () => {
    expect(filtrarMembros(MEMBROS, 'ana@exemplo').map((m) => m.user_id)).toEqual(['u-ana']);
  });
});

describe('dadosDoBloco', () => {
  it('só entrega os dados de bloco pronto', () => {
    expect(dadosDoBloco({ fase: 'carregando' })).toBeNull();
    expect(dadosDoBloco({ fase: 'falhou' })).toBeNull();
    expect(dadosDoBloco({ fase: 'pronto', dados: [] })).toEqual([]);
  });
});

describe('montarJsonDosIds', () => {
  const json = montarJsonDosIds({
    conta: { id: 'conta-1', nome: 'Escritório Exemplo' },
    funis: montarFunis(FUNIS, ETAPAS),
    etiquetas: [{ id: 't1', nome: 'Bancário', cor: '#1d4ed8' }],
    campos: agruparCampos(CAMPOS, GRUPOS),
    rotuloDoGeral: 'Geral',
    conexoes: CANAIS,
    membros: MEMBROS,
  });

  it('usa os nomes da API v1', () => {
    expect(json.account).toEqual({ id: 'conta-1', name: 'Escritório Exemplo' });
    expect(json.pipelines?.[0]).toMatchObject({ id: 'f-comercial', name: 'Comercial' });
    expect(json.tags).toEqual([{ id: 't1', name: 'Bancário', color: '#1d4ed8' }]);
    expect(json.channels?.[0]).toEqual({
      id: 'ch-oficial',
      label: 'Atendimento',
      kind: 'meta',
      display_phone: '+55 11 90000-0001',
      ig_username: null,
      is_default: true,
    });
  });

  it('traduz o resultado da etapa para o vocabulário de deals.status', () => {
    const etapas = json.pipelines?.[0].stages ?? [];
    expect(etapas.map((e) => e.closes_as)).toEqual([null, null, 'won', 'lost']);
  });

  it('leva a chave de cada campo e o bloco pelo nome, com o Geral pelo dicionário', () => {
    expect(json.custom_fields).toEqual([
      { id: 'c-email', field_key: 'email', field_name: 'E-mail', field_type: 'text', group: 'Geral' },
      {
        id: 'c-divida',
        field_key: 'tamanho_da_divida',
        field_name: 'Tamanho da dívida',
        field_type: 'number',
        group: 'Bancário',
      },
      { id: 'c-banco', field_key: 'banco', field_name: 'Banco', field_type: 'text', group: 'Bancário' },
    ]);
  });

  it('não inventa e-mail de membro que a rota escondeu', () => {
    expect(json.members?.[1]).toEqual({
      user_id: 'u-bruno',
      full_name: 'Bruno Teste',
      email: null,
      role: 'agent',
    });
  });

  it('bloco que não carregou sai como null, nunca como lista vazia', () => {
    const parcial = montarJsonDosIds({
      conta: null,
      funis: null,
      etiquetas: [],
      campos: null,
      rotuloDoGeral: 'Geral',
      conexoes: null,
      membros: null,
    });
    expect(parcial).toEqual({
      account: null,
      pipelines: null,
      tags: [],
      custom_fields: null,
      channels: null,
      members: null,
    });
  });
});
