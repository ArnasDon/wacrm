import { describe, expect, it } from 'vitest';

import type { ContextoDeAcesso } from '@/lib/perfis/tipos';

import {
  agruparPorEtapa,
  negociosNoEscopo,
  valorDoNegocio,
  type NegocioDoBloco,
} from './negocios';

const SEM_RECORTE: ContextoDeAcesso = { papel: 'admin', perfil: null };

/** Perfil que só enxerga o funil `trab`. */
const SO_TRABALHISTA: ContextoDeAcesso = {
  papel: 'agent',
  perfil: {
    id: 'p1',
    account_id: 'c1',
    nome: 'Trabalhista',
    papel_base: 'agent',
    sistema: false,
    telas: [],
    secoes_config: [],
    channel_ids: [],
    pipeline_ids: ['trab'],
  },
};

const negocio = (over: Partial<NegocioDoBloco> = {}): NegocioDoBloco => ({
  id: 'd1',
  title: 'Cliente',
  value: 1000,
  pipeline_id: 'trab',
  stage_id: 'e1',
  pipeline: { id: 'trab', name: 'Trabalhista' },
  stage: { id: 'e1', name: 'Lead', position: 0 },
  ...over,
});

describe('valorDoNegocio', () => {
  it('aceita número e a STRING que o PostgREST pode devolver num numeric', () => {
    expect(valorDoNegocio(1500.5)).toBe(1500.5);
    expect(valorDoNegocio('1500.50')).toBe(1500.5);
  });

  it('nulo, vazio e lixo contam zero — nunca NaN no total da tela', () => {
    expect(valorDoNegocio(null)).toBe(0);
    expect(valorDoNegocio(undefined)).toBe(0);
    expect(valorDoNegocio('')).toBe(0);
    expect(valorDoNegocio('abc')).toBe(0);
  });
});

describe('negociosNoEscopo', () => {
  it('sem recorte, passa tudo', () => {
    const lista = [negocio(), negocio({ id: 'd2', pipeline_id: 'banc' })];
    expect(negociosNoEscopo(lista, SEM_RECORTE)).toHaveLength(2);
  });

  it('recorta pelo funil do perfil', () => {
    const lista = [negocio(), negocio({ id: 'd2', pipeline_id: 'banc' })];
    expect(negociosNoEscopo(lista, SO_TRABALHISTA).map((n) => n.id)).toEqual([
      'd1',
    ]);
  });

  it('⚠️ negócio SEM funil passa — esconder afirmaria o que ninguém sabe', () => {
    const lista = [negocio({ id: 'orfao', pipeline_id: null })];
    expect(negociosNoEscopo(lista, SO_TRABALHISTA)).toHaveLength(1);
  });
});

describe('agruparPorEtapa', () => {
  it('soma quantidade e valor por (funil, etapa)', () => {
    const grupos = agruparPorEtapa(
      [
        negocio({ id: 'a', value: 1000 }),
        negocio({ id: 'b', value: '500' }),
        negocio({
          id: 'c',
          stage_id: 'e2',
          stage: { id: 'e2', name: 'Proposta', position: 1 },
          value: 200,
        }),
      ],
      SEM_RECORTE
    );
    expect(grupos).toHaveLength(2);
    expect(grupos[0]).toMatchObject({
      etapaNome: 'Lead',
      quantidade: 2,
      valor: 1500,
    });
    expect(grupos[1]).toMatchObject({ etapaNome: 'Proposta', quantidade: 1 });
  });

  it('ordena pela POSIÇÃO da etapa, não por quantidade', () => {
    const grupos = agruparPorEtapa(
      [
        negocio({
          id: 'a',
          stage_id: 'e3',
          stage: { id: 'e3', name: 'Contrato', position: 2 },
        }),
        negocio({ id: 'b' }),
        negocio({ id: 'c' }),
        negocio({ id: 'd' }),
      ],
      SEM_RECORTE
    );
    expect(grupos.map((g) => g.etapaNome)).toEqual(['Lead', 'Contrato']);
  });

  it('etapa sem posição vai para o FIM', () => {
    const grupos = agruparPorEtapa(
      [
        negocio({ id: 'a', stage_id: 'sp', stage: { id: 'sp', name: 'Sem pos' } }),
        negocio({ id: 'b' }),
      ],
      SEM_RECORTE
    );
    expect(grupos.map((g) => g.etapaNome)).toEqual(['Lead', 'Sem pos']);
  });

  it('aplica o recorte de funil antes de agrupar', () => {
    const grupos = agruparPorEtapa(
      [
        negocio(),
        negocio({
          id: 'x',
          pipeline_id: 'banc',
          pipeline: { id: 'banc', name: 'Bancário' },
        }),
      ],
      SO_TRABALHISTA
    );
    expect(grupos).toHaveLength(1);
    expect(grupos[0].funilNome).toBe('Trabalhista');
  });
});
