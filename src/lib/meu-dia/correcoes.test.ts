import { describe, expect, it } from 'vitest';

import {
  ORDEM_DAS_FONTES,
  resumirCorrecoes,
  type EstadoPorFonte,
  type FonteDeCorrecao,
} from './correcoes';

const pronto = (quantidade: number, aoMenos = false) =>
  ({ status: 'pronto', contagem: { quantidade, aoMenos } }) as const;

/** Todas as seis fontes prontas e zeradas — o cenário de conta saudável. */
const tudoZerado = (): EstadoPorFonte =>
  Object.fromEntries(
    ORDEM_DAS_FONTES.map((f) => [f, pronto(0)])
  ) as EstadoPorFonte;

describe('resumirCorrecoes', () => {
  it('só diz "limpo" com as SEIS fontes prontas e zeradas', () => {
    expect(resumirCorrecoes(tudoZerado()).situacao).toBe('limpo');
  });

  it('mapa VAZIO é "conferindo", nunca "limpo"', () => {
    const r = resumirCorrecoes({});
    expect(r.situacao).toBe('conferindo');
    expect(r.conferindo).toHaveLength(ORDEM_DAS_FONTES.length);
  });

  it('fonte AUSENTE do mapa conta como carregando', () => {
    const estados = tudoZerado();
    delete estados.conexoes;
    const r = resumirCorrecoes(estados);
    expect(r.situacao).toBe('conferindo');
    expect(r.conferindo).toEqual(['conexoes']);
  });

  it('⚠️ zero com uma consulta que FALHOU é "incompleto", não "limpo"', () => {
    const r = resumirCorrecoes({ ...tudoZerado(), agendadasFalharam: { status: 'falhou' } });
    expect(r.situacao).toBe('incompleto');
    expect(r.naoConferidas).toEqual(['agendadasFalharam']);
    expect(r.total).toBe(0);
  });

  it('problema conhecido aparece mesmo com outra fonte em voo', () => {
    const r = resumirCorrecoes({
      ...tudoZerado(),
      agendadasFalharam: pronto(3),
      conexoes: { status: 'carregando' },
    });
    expect(r.situacao).toBe('temProblema');
    expect(r.achados).toEqual([
      { fonte: 'agendadasFalharam', quantidade: 3, aoMenos: false },
    ]);
    expect(r.conferindo).toEqual(['conexoes']);
  });

  it('problema conhecido vence uma fonte que falhou', () => {
    const r = resumirCorrecoes({
      ...tudoZerado(),
      automacoesFalharam: pronto(1),
      agendador: { status: 'falhou' },
    });
    expect(r.situacao).toBe('temProblema');
    expect(r.naoConferidas).toEqual(['agendador']);
  });

  it('ordena por GRAVIDADE, não pela ordem de chegada', () => {
    const estados: EstadoPorFonte = {
      ...tudoZerado(),
      entradasNaoProcessadas: pronto(9),
      agendador: pronto(1),
      automacoesFalharam: pronto(2),
    };
    expect(resumirCorrecoes(estados).achados.map((a) => a.fonte)).toEqual([
      'agendador',
      'automacoesFalharam',
      'entradasNaoProcessadas',
    ]);
  });

  it('soma os achados e propaga o PISO de qualquer parcela', () => {
    const r = resumirCorrecoes({
      ...tudoZerado(),
      agendadasFalharam: pronto(4),
      entregaIncerta: pronto(6, true),
    });
    expect(r.total).toBe(10);
    expect(r.aoMenos).toBe(true);
  });

  it('sem piso em nenhuma parcela, o total é exato', () => {
    const r = resumirCorrecoes({ ...tudoZerado(), entregaIncerta: pronto(6) });
    expect(r.total).toBe(6);
    expect(r.aoMenos).toBe(false);
  });

  it('mensagem RETIDA sem telefone (1010) vem junto das conexões, antes das agendadas', () => {
    const r = resumirCorrecoes({
      ...tudoZerado(),
      agendadasFalharam: pronto(1),
      mensagensRetidas: pronto(2),
      conexoesAtrasadas: pronto(1),
    });
    expect(r.achados.map((a) => a.fonte)).toEqual([
      'conexoesAtrasadas',
      'mensagensRetidas',
      'agendadasFalharam',
    ]);
  });

  it('retidas que a rota NÃO conseguiu conferir impedem o "tudo em ordem"', () => {
    const r = resumirCorrecoes({ ...tudoZerado(), mensagensRetidas: { status: 'falhou' } });
    expect(r.situacao).toBe('incompleto');
    expect(r.naoConferidas).toEqual(['mensagensRetidas']);
  });

  it('a ordem declarada não tem repetição nem sobra', () => {
    const vistas = new Set<FonteDeCorrecao>(ORDEM_DAS_FONTES);
    expect(vistas.size).toBe(ORDEM_DAS_FONTES.length);
  });
});
