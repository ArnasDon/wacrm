import { describe, expect, it, beforeEach } from 'vitest';

import { toneFor, piorTom, comCache, STALE_MS, __limparCacheDeSaude } from './health';
import { VALIDADE_DA_MEDICAO_MS } from './atraso-de-entrega';

const BASE = {
  status: 'connected' as const,
  estadoVivo: null,
  checkedAt: null,
  lastError: null,
  incompleto: false,
  webhookOk: null,
  /** Nível 3: nunca medido. `null` é "não sei", e não acusa (1002). */
  atrasoSeg: null,
  atrasoMedidoEm: null,
  agoraMs: 1_000_000_000_000,
};

const agora = (msAtras: number) => new Date(BASE.agoraMs - msAtras).toISOString();

describe('toneFor — a regra que o indicador carrega', () => {
  it('conectado E confirmado agora = verde', () => {
    expect(toneFor({ ...BASE, estadoVivo: 'open' })).toEqual({ tone: 'ok', detail: null });
  });

  it('LINHA DIZ CONECTADO, MAS NINGUÉM CONFIRMOU HÁ MUITO = amarelo', () => {
    // É o caso que motivou o módulo inteiro: em produção havia um canal
    // marcado `connected` com a última atualização de 23h antes. Verde ali
    // seria a mentira mais cara possível.
    const r = toneFor({ ...BASE, estadoVivo: null, checkedAt: agora(24 * 3600_000) });
    expect(r).toEqual({ tone: 'warn', detail: 'stale' });
  });

  it('conectado, sem resposta agora, mas verificado há pouco = verde', () => {
    const r = toneFor({ ...BASE, estadoVivo: null, checkedAt: agora(STALE_MS / 2) });
    expect(r.tone).toBe('ok');
  });

  it('nunca verificado e sem resposta = amarelo, não verde', () => {
    expect(toneFor({ ...BASE, estadoVivo: null, checkedAt: null }).tone).toBe('warn');
  });

  it('provedor diz que fechou = vermelho', () => {
    expect(toneFor({ ...BASE, estadoVivo: 'close' })).toEqual({
      tone: 'down',
      detail: 'closed',
    });
  });

  it('pareando = amarelo', () => {
    expect(toneFor({ ...BASE, estadoVivo: 'connecting' }).tone).toBe('warn');
  });

  it('conectado no provedor mas webhook apontando para fora = amarelo', () => {
    // WhatsApp de pé e CRM surdo — o único motivo do nível 2 existir.
    expect(toneFor({ ...BASE, estadoVivo: 'open', webhookOk: false })).toEqual({
      tone: 'warn',
      detail: 'webhook',
    });
  });

  it('webhook indeterminado NÃO acusa nada', () => {
    // "Não consegui ler" não é "está errado".
    expect(toneFor({ ...BASE, estadoVivo: 'open', webhookOk: null }).tone).toBe('ok');
  });

  it('configuração incompleta é cinza, não vermelho', () => {
    // Nunca pareado ≠ caiu. Vermelho mandaria procurar uma queda que não houve.
    expect(toneFor({ ...BASE, incompleto: true })).toEqual({
      tone: 'unknown',
      detail: 'incomplete',
    });
  });

  it('erro registrado rebaixa verde para amarelo', () => {
    expect(toneFor({ ...BASE, estadoVivo: 'open', lastError: 'algo' }).tone).toBe('warn');
  });

  it('sem resposta e linha desconectada = vermelho', () => {
    expect(toneFor({ ...BASE, status: 'disconnected', estadoVivo: null }).tone).toBe('down');
  });

  // ---- Nível 3: entregando TARDE (1002) ----

  it('DE PÉ, OUVINDO, SEM ERRO — E ENTREGANDO 29 MIN TARDE = amarelo', () => {
    // O episódio de 16/09/2026, que passou a manhã inteira verde. A conexão
    // respondia `open`, o webhook apontava para cá e o frescor era novo:
    // os dois eixos antigos diziam "saudável" com verdade, e ainda assim o
    // atendente lia uma conversa com meia hora de defasagem.
    expect(
      toneFor({
        ...BASE,
        estadoVivo: 'open',
        atrasoSeg: 29 * 60,
        atrasoMedidoEm: agora(30_000),
      }),
    ).toEqual({ tone: 'warn', detail: 'lagging' });
  });

  it('atraso NUNCA MEDIDO não acusa — null é "não sei", não zero', () => {
    expect(toneFor({ ...BASE, estadoVivo: 'open', atrasoSeg: null }).tone).toBe('ok');
  });

  it('a operação normal medida (segundos) continua verde', () => {
    expect(toneFor({ ...BASE, estadoVivo: 'open', atrasoSeg: 6 }).tone).toBe('ok');
  });

  it('o atraso vale mesmo quando o provedor não respondeu', () => {
    // É medição LOCAL, feita na nossa ingestão: não depende de ninguém
    // responder para ser verdade.
    expect(
      toneFor({
        ...BASE,
        estadoVivo: null,
        checkedAt: agora(1_000),
        atrasoSeg: 40 * 60,
        atrasoMedidoEm: agora(30_000),
      }),
    ).toEqual({ tone: 'warn', detail: 'lagging' });
  });

  it('queda ganha de atraso — vermelho descreve melhor o que houve', () => {
    expect(
      toneFor({
        ...BASE,
        estadoVivo: 'close',
        atrasoSeg: 40 * 60,
        atrasoMedidoEm: agora(30_000),
      }).tone,
    ).toBe('down');
  });

  it('⚠️ MEDIÇÃO VELHA não afirma nada sobre agora (Codex, 3ª rodada)', () => {
    // Uma amostra atrasada seguida de silêncio mantinha `lagging` para
    // sempre: a régua olhava só o atraso histórico e nunca a IDADE dele. O
    // cabeçalho e o Meu dia diriam "esta conexão está entregando tarde"
    // horas depois da última mensagem, sobre uma conexão que pode ter se
    // recuperado — e o alarme que não apaga sozinho é o que ensina o
    // operador a ignorá-lo.
    expect(
      toneFor({
        ...BASE,
        estadoVivo: 'open',
        atrasoSeg: 29 * 60,
        atrasoMedidoEm: agora(3 * 3600_000),
      }).tone,
    ).toBe('ok');
  });

  it('a medição no limite da validade ainda acende, e um instante além não', () => {
    const noLimite = toneFor({
      ...BASE,
      estadoVivo: 'open',
      atrasoSeg: 29 * 60,
      atrasoMedidoEm: agora(VALIDADE_DA_MEDICAO_MS),
    });
    expect(noLimite.detail).toBe('lagging');
    const passou = toneFor({
      ...BASE,
      estadoVivo: 'open',
      atrasoSeg: 29 * 60,
      atrasoMedidoEm: agora(VALIDADE_DA_MEDICAO_MS + 1_000),
    });
    expect(passou.tone).toBe('ok');
  });

  it('atraso medido MAS sem carimbo de quando não acusa', () => {
    // Estado impossível hoje (as duas colunas andam juntas), mas a régua não
    // pode CONFIAR nisso: sem saber quando, não dá para falar do presente.
    expect(
      toneFor({ ...BASE, estadoVivo: 'open', atrasoSeg: 29 * 60, atrasoMedidoEm: null }).tone,
    ).toBe('ok');
  });

  it('webhook apontado para fora ganha de atraso — é a causa, não o sintoma', () => {
    expect(
      toneFor({
        ...BASE,
        estadoVivo: 'open',
        webhookOk: false,
        atrasoSeg: 40 * 60,
        atrasoMedidoEm: agora(30_000),
      }),
    ).toEqual({ tone: 'warn', detail: 'webhook' });
  });
});

describe('piorTom', () => {
  it('vermelho ganha de tudo', () => {
    expect(piorTom(['ok', 'warn', 'down', 'unknown'])).toBe('down');
  });
  it('amarelo ganha de cinza e verde', () => {
    expect(piorTom(['ok', 'unknown', 'warn'])).toBe('warn');
  });
  it('tudo verde é verde', () => {
    expect(piorTom(['ok', 'ok'])).toBe('ok');
  });
  it('lista vazia é verde (não há canal para estar doente)', () => {
    expect(piorTom([])).toBe('ok');
  });
});

describe('comCache — single-flight', () => {
  beforeEach(() => __limparCacheDeSaude());

  it('não repete a chamada dentro do TTL', async () => {
    let chamadas = 0;
    const produzir = async () => {
      chamadas++;
      return 'x';
    };
    await comCache('k', 10_000, produzir);
    await comCache('k', 10_000, produzir);
    expect(chamadas).toBe(1);
  });

  it('chamadas concorrentes colapsam numa só', async () => {
    // É o que impede dez abas atualizando juntas de virarem dez requisições
    // ao servidor Evolution.
    let chamadas = 0;
    const produzir = async () => {
      chamadas++;
      await new Promise((r) => setTimeout(r, 10));
      return 'x';
    };
    await Promise.all([
      comCache('k', 10_000, produzir),
      comCache('k', 10_000, produzir),
      comCache('k', 10_000, produzir),
    ]);
    expect(chamadas).toBe(1);
  });

  it('falha não fica cacheada — a próxima tentativa refaz', async () => {
    let chamadas = 0;
    const produzir = async () => {
      chamadas++;
      throw new Error('servidor mudo');
    };
    await expect(comCache('k', 10_000, produzir)).rejects.toThrow();
    await expect(comCache('k', 10_000, produzir)).rejects.toThrow();
    expect(chamadas).toBe(2);
  });
});

describe('estadoDaFalhaDoInstagram — rede fora não é queda', () => {
  it('tempo esgotado ou host fora = "não sei" (null), nunca "caiu"', async () => {
    const { estadoDaFalhaDoInstagram } = await import('./health');
    const { InstagramApiError } = await import('@/lib/instagram/graph');
    expect(estadoDaFalhaDoInstagram(new InstagramApiError('rede', 'timeout'))).toBeNull();
    // Limite de chamadas e 5xx da Meta também não dizem nada sobre o token
    // (revisão do PR #167).
    expect(estadoDaFalhaDoInstagram(new InstagramApiError('limite', 'x', 429))).toBeNull();
    expect(estadoDaFalhaDoInstagram(new InstagramApiError('meta_error', 'x', 503))).toBeNull();
  });

  it('resposta da Meta (token inválido, sem permissão, outro erro) = caiu', async () => {
    const { estadoDaFalhaDoInstagram } = await import('./health');
    const { InstagramApiError } = await import('@/lib/instagram/graph');
    expect(estadoDaFalhaDoInstagram(new InstagramApiError('token_invalido', 'x', 400, 190))).toBe('close');
    expect(estadoDaFalhaDoInstagram(new InstagramApiError('sem_permissao', 'x', 403))).toBe('close');
    expect(estadoDaFalhaDoInstagram(new InstagramApiError('meta_error', 'x', 400))).toBe('close');
    // Erro que não é da API (bug nosso, decrypt falhou): melhor acusar do que esconder.
    expect(estadoDaFalhaDoInstagram(new Error('boom'))).toBe('close');
  });
});
