// ============================================================
// Quatro horas sem ninguém mexer: a régua da guarda de inatividade, pura.
//
// Decisão do operador (12/09/2026): depois de 4 h sem atividade em nenhuma
// aba deste navegador, o Meu dia VOLTA a aparecer — sem pedir senha (a F2b,
// que encerraria a sessão, ficou para depois). Cobre a aba deixada aberta de
// um dia para o outro no computador do escritório, que a regra "primeiro
// acesso do dia" da porta não alcança (ela só é avaliada ao carregar).
//
// ⚠️ O relógio é COMPARTILHADO entre as abas (uma chave por pessoa no
// `localStorage`): atividade em qualquer aba mantém todas vivas. Só por aba
// (o molde do `presence-heartbeat`) derrubaria quem trabalha na outra.
//
// ⚠️ O registro é AMARRADO à sessão de login: registro de OUTRA sessão (login
// novo) ou ausente NUNCA expira — vira "gravar agora". Sem isso, o carimbo de
// ontem derrubaria o login de hoje no primeiro render, e o dia do deploy
// derrubaria todo mundo.
//
// ⚠️ Confere ANTES de gravar: mexer o mouse às 4h05 não pode ressuscitar a
// sessão — é o gesto que acorda a tela, e é ele que a guarda intercepta.
// ============================================================

/** Quatro horas: o número que o operador pediu. */
export const INATIVIDADE_MAX_MS = 4 * 60 * 60_000;

/** O relógio é regravado no máximo a cada 30 s — `mousemove` dispara centenas de vezes por segundo. */
export const GRAVAR_A_CADA_MS = 30_000;

/** A conferência periódica, para a aba parada (sem evento nenhum) descobrir que expirou. */
export const CONFERIR_A_CADA_MS = 60_000;

export interface RegistroDeAtividade {
  /** `session_id` do token que estava ativo quando a pessoa mexeu. */
  sessao: string;
  /** Instante da última atividade, em ms desde a época. */
  em: number;
}

export function chaveDeAtividade(userId: string): string {
  return `cb-atividade:${userId}`;
}

/** PARSE, nunca `as`: forma estranha vale como ausente (= gravar agora, nunca expirar). */
export function lerRegistroDeAtividade(
  bruto: string | null | undefined
): RegistroDeAtividade | null {
  if (!bruto) return null;
  let valor: unknown;
  try {
    valor = JSON.parse(bruto);
  } catch {
    return null;
  }
  if (!valor || typeof valor !== 'object') return null;
  const r = valor as Record<string, unknown>;
  if (typeof r.sessao !== 'string' || r.sessao.length === 0) return null;
  if (typeof r.em !== 'number' || !Number.isFinite(r.em)) return null;
  return { sessao: r.sessao, em: r.em };
}

export function novoRegistroDeAtividade(
  sessao: string,
  agoraMs: number
): RegistroDeAtividade {
  return { sessao, em: agoraMs };
}

export type DecisaoDeAtividade = 'expirou' | 'iniciar' | 'gravar' | 'nada';

/**
 * A régua. `sessao` nula = a guarda não decide nem grava (token sem a claim):
 * `null === null` como "mesma sessão" faria um registro sem sessão valer para
 * todo login futuro, ou derrubar todos.
 *
 * - registro ausente, de outra sessão ou no futuro (relógio ajustado) →
 *   `iniciar` (nunca expira; o relógio nasce agora);
 * - mesma sessão há 4 h ou mais → `expirou`;
 * - mesma sessão há 30 s ou mais → `gravar`; senão `nada`.
 */
export function decidir(
  registro: RegistroDeAtividade | null,
  sessao: string | null,
  agoraMs: number
): DecisaoDeAtividade {
  if (sessao === null) return 'nada';
  if (!registro || registro.sessao !== sessao) return 'iniciar';
  const decorrido = agoraMs - registro.em;
  if (decorrido < 0) return 'iniciar';
  if (decorrido >= INATIVIDADE_MAX_MS) return 'expirou';
  if (decorrido >= GRAVAR_A_CADA_MS) return 'gravar';
  return 'nada';
}

export interface PassoDaGuarda {
  /** Reabrir o Meu dia agora. */
  expirar: boolean;
  /** Regravar o relógio com o instante de agora. */
  gravar: boolean;
}

/**
 * O que a guarda FAZ a cada conferência — a parte que a revisão fria pegou
 * errada na primeira versão, por isso é pura e testada:
 *
 * ⚠️ Só GESTO regrava o relógio. A conferência periódica (60 s) e a de
 * volta à aba (`focus`/`visibilitychange`) só CONFEREM: se elas gravassem,
 * o relógio andaria sozinho a cada tique e a guarda nunca expiraria com a
 * aba aberta — medido: 12 h simuladas, zero expirações, que é exatamente o
 * caso ("aba deixada aberta de um dia para o outro") que ela existe para
 * cobrir.
 *
 * ⚠️ Expirar NÃO grava. O relógio é compartilhado: a aba que expira
 * primeiro apagaria a expiração para as outras (a de fundo ganha a corrida,
 * reabre invisível, e a visível nunca reabre), e um F5 antes do "Continuar"
 * faria a carga seguinte ler um carimbo fresco e abrir o app em silêncio.
 * Quem regrava depois da expiração é o "Continuar" da porta.
 *
 * ⚠️ Com o Meu dia já na frente (`ativa` false) nada é gravado — nem por
 * gesto: o F5 é um `keydown`, e gravá-lo esconderia a reabertura da carga
 * seguinte. `iniciar` (sem registro, outra sessão, futuro) grava sem
 * gesto, senão a aba que nasce e não é tocada nunca ganha relógio.
 */
export function passoDaGuarda(args: {
  registro: RegistroDeAtividade | null;
  sessao: string | null;
  agoraMs: number;
  /** O app está na tela (a porta não está pendente)? */
  ativa: boolean;
  /** A conferência veio de um gesto da pessoa, não do relógio ou da aba. */
  porGesto: boolean;
}): PassoDaGuarda {
  const decisao = decidir(args.registro, args.sessao, args.agoraMs);
  if (decisao === 'expirou') return { expirar: args.ativa, gravar: false };
  if (decisao === 'iniciar') return { expirar: false, gravar: args.ativa };
  if (decisao === 'gravar')
    return { expirar: false, gravar: args.ativa && args.porGesto };
  return { expirar: false, gravar: false };
}
