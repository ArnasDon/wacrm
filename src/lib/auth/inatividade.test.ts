import { describe, expect, it } from 'vitest';
import {
  GRAVAR_A_CADA_MS,
  INATIVIDADE_MAX_MS,
  chaveDeAtividade,
  decidir,
  lerRegistroDeAtividade,
  novoRegistroDeAtividade,
  passoDaGuarda,
} from './inatividade';

const AGORA = Date.parse('2026-09-12T12:00:00Z');
const h = (n: number) => n * 60 * 60_000;

describe('decidir', () => {
  it('sessionId nulo: não decide nem grava', () => {
    expect(
      decidir(novoRegistroDeAtividade('s1', AGORA - h(10)), null, AGORA)
    ).toBe('nada');
    expect(decidir(null, null, AGORA)).toBe('nada');
  });

  it('registro ausente ou de OUTRA sessão nunca expira — o relógio nasce agora', () => {
    expect(decidir(null, 's1', AGORA)).toBe('iniciar');
    expect(
      decidir(novoRegistroDeAtividade('s0', AGORA - h(30)), 's1', AGORA)
    ).toBe('iniciar');
  });

  it('mesma sessão: 3h59 grava, 4h expira, 4h01 expira mesmo com atividade chegando', () => {
    expect(
      decidir(novoRegistroDeAtividade('s1', AGORA - h(4) + 60_000), 's1', AGORA)
    ).toBe('gravar');
    expect(
      decidir(novoRegistroDeAtividade('s1', AGORA - h(4)), 's1', AGORA)
    ).toBe('expirou');
    expect(
      decidir(novoRegistroDeAtividade('s1', AGORA - h(4) - 60_000), 's1', AGORA)
    ).toBe('expirou');
    expect(INATIVIDADE_MAX_MS).toBe(h(4));
  });

  it('intervalo de gravação: 10 s não regrava, 30 s regrava', () => {
    expect(
      decidir(novoRegistroDeAtividade('s1', AGORA - 10_000), 's1', AGORA)
    ).toBe('nada');
    expect(
      decidir(
        novoRegistroDeAtividade('s1', AGORA - GRAVAR_A_CADA_MS),
        's1',
        AGORA
      )
    ).toBe('gravar');
  });

  it('registro no futuro (relógio ajustado) recomeça agora, nunca "expirou"', () => {
    expect(
      decidir(novoRegistroDeAtividade('s1', AGORA + h(1)), 's1', AGORA)
    ).toBe('iniciar');
  });
});

describe('passoDaGuarda (o que a guarda faz a cada conferência)', () => {
  const parado2h = novoRegistroDeAtividade('s1', AGORA - h(2));
  const parado5h = novoRegistroDeAtividade('s1', AGORA - h(5));
  const base = { sessao: 's1', agoraMs: AGORA, ativa: true, porGesto: false };

  it('o tique do relógio numa aba parada NÃO regrava — senão a guarda nunca expira', () => {
    expect(passoDaGuarda({ ...base, registro: parado2h })).toEqual({
      expirar: false,
      gravar: false,
    });
  });

  it('12 h de tiques sem gesto terminam em expiração (a simulação da revisão fria)', () => {
    let registro = novoRegistroDeAtividade('s1', AGORA);
    let expirou = false;
    for (let t = AGORA + 60_000; t <= AGORA + h(12); t += 60_000) {
      const passo = passoDaGuarda({
        registro,
        sessao: 's1',
        agoraMs: t,
        ativa: true,
        porGesto: false,
      });
      if (passo.gravar) registro = novoRegistroDeAtividade('s1', t);
      if (passo.expirar) {
        expirou = true;
        break;
      }
    }
    expect(expirou).toBe(true);
  });

  it('gesto regrava (a cada 30 s), e só com o app na tela', () => {
    expect(
      passoDaGuarda({ ...base, registro: parado2h, porGesto: true })
    ).toEqual({ expirar: false, gravar: true });
    expect(
      passoDaGuarda({
        ...base,
        registro: parado2h,
        porGesto: true,
        ativa: false,
      })
    ).toEqual({
      expirar: false,
      gravar: false,
    });
    const recente = novoRegistroDeAtividade('s1', AGORA - 5_000);
    expect(
      passoDaGuarda({ ...base, registro: recente, porGesto: true })
    ).toEqual({ expirar: false, gravar: false });
  });

  it('4 h paradas: expira SEM gravar (o relógio é compartilhado; quem regrava é o Continuar)', () => {
    expect(passoDaGuarda({ ...base, registro: parado5h })).toEqual({
      expirar: true,
      gravar: false,
    });
    expect(
      passoDaGuarda({ ...base, registro: parado5h, porGesto: true })
    ).toEqual({ expirar: true, gravar: false });
  });

  it('com o Meu dia já na frente, expirar de novo é ruído e nada é gravado — nem por gesto (o F5 é um keydown)', () => {
    expect(
      passoDaGuarda({ ...base, registro: parado5h, ativa: false })
    ).toEqual({ expirar: false, gravar: false });
    expect(
      passoDaGuarda({
        ...base,
        registro: parado5h,
        ativa: false,
        porGesto: true,
      })
    ).toEqual({
      expirar: false,
      gravar: false,
    });
  });

  it('sem registro (ou outra sessão) o relógio nasce sem gesto, com o app na tela', () => {
    expect(passoDaGuarda({ ...base, registro: null })).toEqual({
      expirar: false,
      gravar: true,
    });
    expect(
      passoDaGuarda({ ...base, registro: novoRegistroDeAtividade('s0', AGORA) })
    ).toEqual({
      expirar: false,
      gravar: true,
    });
    expect(passoDaGuarda({ ...base, registro: null, ativa: false })).toEqual({
      expirar: false,
      gravar: false,
    });
  });

  it('sessionId nulo: nunca expira, nunca grava', () => {
    expect(
      passoDaGuarda({
        ...base,
        sessao: null,
        registro: parado5h,
        porGesto: true,
      })
    ).toEqual({
      expirar: false,
      gravar: false,
    });
  });
});

describe('lerRegistroDeAtividade (parse, nunca cast)', () => {
  it('lê um registro bem formado', () => {
    expect(
      lerRegistroDeAtividade(JSON.stringify({ sessao: 's1', em: AGORA }))
    ).toEqual({ sessao: 's1', em: AGORA });
  });

  it('forma estranha vale como ausente', () => {
    expect(lerRegistroDeAtividade(null)).toBeNull();
    expect(lerRegistroDeAtividade('')).toBeNull();
    expect(lerRegistroDeAtividade('{quebrado')).toBeNull();
    expect(lerRegistroDeAtividade('"texto"')).toBeNull();
    expect(
      lerRegistroDeAtividade(JSON.stringify({ sessao: '', em: AGORA }))
    ).toBeNull();
    expect(
      lerRegistroDeAtividade(JSON.stringify({ sessao: null, em: AGORA }))
    ).toBeNull();
    expect(lerRegistroDeAtividade(JSON.stringify({ sessao: 's1' }))).toBeNull();
    expect(
      lerRegistroDeAtividade(JSON.stringify({ sessao: 's1', em: '2026-09-12' }))
    ).toBeNull();
    expect(
      lerRegistroDeAtividade(JSON.stringify({ sessao: 's1', em: Number.NaN }))
    ).toBeNull();
  });
});

describe('chaveDeAtividade', () => {
  it('é por pessoa e não colide com a chave do Meu dia', () => {
    expect(chaveDeAtividade('u1')).not.toBe(chaveDeAtividade('u2'));
    expect(chaveDeAtividade('u1')).toContain('u1');
    expect(chaveDeAtividade('u1')).not.toContain('meu-dia');
  });
});
