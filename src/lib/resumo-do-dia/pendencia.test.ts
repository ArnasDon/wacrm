import { describe, expect, it } from 'vitest';
import {
  JANELA_SEM_REGISTRO_MS,
  chaveDoRegistro,
  decidirEntrada,
  inicioDasNovidades,
  lerRegistro,
  novoRegistro,
  precisaMostrar,
} from './pendencia';

const HOJE = '2026-09-12';
const ONTEM = '2026-09-11';

describe('lerRegistro (parse, nunca cast)', () => {
  it('lê um registro bem formado', () => {
    const bruto = JSON.stringify({
      sessao: 's1',
      dia: HOJE,
      confirmadoEm: '2026-09-12T11:00:00.000Z',
    });
    expect(lerRegistro(bruto)).toEqual({
      sessao: 's1',
      dia: HOJE,
      confirmadoEm: '2026-09-12T11:00:00.000Z',
    });
  });

  it('sessão ausente, vazia ou de outro tipo vira null', () => {
    const base = { dia: HOJE, confirmadoEm: '2026-09-12T11:00:00.000Z' };
    expect(lerRegistro(JSON.stringify(base))?.sessao).toBeNull();
    expect(
      lerRegistro(JSON.stringify({ ...base, sessao: '' }))?.sessao
    ).toBeNull();
    expect(
      lerRegistro(JSON.stringify({ ...base, sessao: 7 }))?.sessao
    ).toBeNull();
  });

  it('forma estranha = registro ausente', () => {
    expect(lerRegistro(null)).toBeNull();
    expect(lerRegistro(undefined)).toBeNull();
    expect(lerRegistro('')).toBeNull();
    expect(lerRegistro('{corrompido')).toBeNull();
    expect(lerRegistro('"texto"')).toBeNull();
    expect(lerRegistro('[]')).toBeNull();
    expect(lerRegistro(JSON.stringify({ sessao: 's1' }))).toBeNull();
    expect(
      lerRegistro(
        JSON.stringify({
          sessao: 's1',
          dia: '12/09/2026',
          confirmadoEm: '2026-09-12T11:00:00Z',
        })
      )
    ).toBeNull();
    expect(
      lerRegistro(
        JSON.stringify({ sessao: 's1', dia: HOJE, confirmadoEm: 'ontem' })
      )
    ).toBeNull();
  });
});

describe('precisaMostrar', () => {
  const registro = novoRegistro('s1', HOJE, new Date('2026-09-12T11:00:00Z'));

  it('sem registro: mostra', () => {
    expect(precisaMostrar(null, 's1', HOJE)).toBe(true);
  });

  it('mesma sessão e mesmo dia: não mostra', () => {
    expect(precisaMostrar(registro, 's1', HOJE)).toBe(false);
  });

  it('outro dia: mostra, mesmo na mesma sessão', () => {
    expect(precisaMostrar({ ...registro, dia: ONTEM }, 's1', HOJE)).toBe(true);
  });

  it('outra sessão (login novo): mostra, mesmo no mesmo dia', () => {
    expect(precisaMostrar(registro, 's2', HOJE)).toBe(true);
  });

  it('sessionId nulo decide só pelo dia — e nunca casa `null === null` como "mesma sessão"', () => {
    expect(precisaMostrar(registro, null, HOJE)).toBe(false);
    expect(precisaMostrar({ ...registro, dia: ONTEM }, null, HOJE)).toBe(true);
    const semSessao = novoRegistro(
      null,
      HOJE,
      new Date('2026-09-12T11:00:00Z')
    );
    expect(precisaMostrar(semSessao, null, HOJE)).toBe(false);
    // Registro gravado sem sessão não vale para um login que TEM sessão.
    expect(precisaMostrar(semSessao, 's1', HOJE)).toBe(true);
  });
});

describe('inicioDasNovidades', () => {
  const agora = Date.parse('2026-09-12T14:00:00Z');

  it('sem registro: últimas 24 h, e o rótulo NÃO é "última entrada"', () => {
    expect(inicioDasNovidades(null, agora)).toEqual({
      desdeMs: agora - JANELA_SEM_REGISTRO_MS,
      daConfirmacao: false,
    });
  });

  it('com registro: a confirmação anterior', () => {
    const r = novoRegistro('s1', ONTEM, new Date('2026-09-11T18:42:00Z'));
    expect(inicioDasNovidades(r, agora)).toEqual({
      desdeMs: Date.parse('2026-09-11T18:42:00Z'),
      daConfirmacao: true,
    });
  });

  it('confirmação no futuro cai na janela padrão — e o rótulo cai junto', () => {
    const r = novoRegistro('s1', HOJE, new Date('2026-09-13T09:00:00Z'));
    expect(inicioDasNovidades(r, agora)).toEqual({
      desdeMs: agora - JANELA_SEM_REGISTRO_MS,
      daConfirmacao: false,
    });
  });
});

describe('decidirEntrada (a decisão inteira da porta)', () => {
  const base = {
    registro: null,
    sessionId: 's1',
    hoje: HOJE,
    accountStatus: 'ready',
    jaLiberadoNestaCarga: false,
  };

  it('conta pronta, nada liberado, sem registro: mostra', () => {
    expect(decidirEntrada(base)).toBe(true);
  });

  it('conta que não resolveu pula a tela, mesmo sem registro', () => {
    expect(decidirEntrada({ ...base, accountStatus: 'error' })).toBe(false);
    expect(decidirEntrada({ ...base, accountStatus: 'unlinked' })).toBe(false);
    expect(decidirEntrada({ ...base, accountStatus: 'loading' })).toBe(false);
  });

  it('já liberado nesta carga não reabre, mesmo com registro de ontem', () => {
    const ontem = novoRegistro('s1', ONTEM, new Date('2026-09-11T18:00:00Z'));
    expect(decidirEntrada({ ...base, registro: ontem })).toBe(true);
    expect(
      decidirEntrada({ ...base, registro: ontem, jaLiberadoNestaCarga: true })
    ).toBe(false);
  });

  it('4 h paradas (inatividade expirou) mostram, mesmo já liberado e já confirmado hoje', () => {
    const hoje = novoRegistro('s1', HOJE, new Date('2026-09-12T11:00:00Z'));
    expect(
      decidirEntrada({
        ...base,
        registro: hoje,
        jaLiberadoNestaCarga: true,
        inatividadeExpirou: true,
      })
    ).toBe(true);
    // Mas nunca com a conta quebrada.
    expect(
      decidirEntrada({
        ...base,
        accountStatus: 'error',
        inatividadeExpirou: true,
      })
    ).toBe(false);
  });

  it('delega o resto a precisaMostrar', () => {
    const hoje = novoRegistro('s1', HOJE, new Date('2026-09-12T11:00:00Z'));
    expect(decidirEntrada({ ...base, registro: hoje })).toBe(false);
    expect(decidirEntrada({ ...base, registro: hoje, sessionId: 's2' })).toBe(
      true
    );
  });
});

describe('chaveDoRegistro', () => {
  it('é por pessoa', () => {
    expect(chaveDoRegistro('u1')).not.toBe(chaveDoRegistro('u2'));
    expect(chaveDoRegistro('u1')).toContain('u1');
  });
});
