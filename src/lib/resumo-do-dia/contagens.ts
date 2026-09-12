// ============================================================
// As contagens do Meu dia — puras, para o teste e para a tela não carregar
// regra nenhuma.
//
// Cada bloco reusa a régua da TELA para onde o clique leva, senão o número do
// resumo e o número da tela discordam: conversas pela régua da caixa de
// entrada (`atrasoDeResposta`, 10 min) e pelo recorte do perfil
// (`conversaNoEscopo`); tarefas por `agruparPorPrazo` (chamado direto pelo
// hook — o dia, nunca a hora). As novidades (avisos por tipo) são COUNT no
// banco, sem linha nenhuma — número exato, sem teto.
//
// ⚠️ "Sem responsável" é ACERVO, não a urgência do dia: medido em 12/09/2026,
// 235 conversas sem responsável esperavam há mais de 10 min, 234 delas há
// mais de 30. Um "235" fixo toda manhã é o número que o olho aprende a
// pular. Por isso a fila é repartida pelo instante da confirmação anterior:
// quem começou a esperar DEPOIS dela é novidade; o resto é o acumulado, em
// texto apagado.
// ============================================================

import { atrasoDeResposta, type Atraso } from '@/lib/inbox/atraso';
import { conversaNoEscopo } from '@/lib/perfis/escopo';
import type { ContextoDeAcesso } from '@/lib/perfis/tipos';
import type { Conversation } from '@/types';

/** Quantos itens cada bloco lista antes do "e mais N". */
export const TETO_DE_ITENS = 5;

export function limitar<T>(
  itens: readonly T[],
  teto: number = TETO_DE_ITENS
): { itens: T[]; restantes: number } {
  return {
    itens: itens.slice(0, teto),
    restantes: Math.max(0, itens.length - teto),
  };
}

// ------------------------------------------------------------
// Conversas
// ------------------------------------------------------------

export interface ConversaEsperando {
  conversa: Conversation;
  atraso: Atraso;
}

/** Mais antiga primeiro: quem espera há mais tempo é quem a pessoa vê primeiro. */
function porEsperaMaisLonga(
  a: ConversaEsperando,
  b: ConversaEsperando
): number {
  return (
    Date.parse(a.conversa.aguardando_desde!) -
    Date.parse(b.conversa.aguardando_desde!)
  );
}

function esperando(c: Conversation, agoraMs: number): ConversaEsperando | null {
  const atraso = atrasoDeResposta(c, agoraMs);
  return atraso ? { conversa: c, atraso } : null;
}

/**
 * As conversas do escopo com cliente esperando há 10 min ou mais, mais antiga
 * primeiro. Exportada porque o hook a chama sobre uma consulta PRÓPRIA (só as
 * que têm `aguardando_desde`): assim o sinal de truncamento das "esperando"
 * é delas, e não da lista de todas as atribuídas — com mil atribuídas e
 * nenhuma esperando, a tela dizia "mais de 0 seus" (Codex, PR #197).
 */
export function conversasEsperando(
  conversas: readonly Conversation[],
  ctx: ContextoDeAcesso,
  agoraMs: number
): ConversaEsperando[] {
  const saida: ConversaEsperando[] = [];
  for (const c of conversas) {
    if (c.status === 'closed' || !conversaNoEscopo(ctx, c)) continue;
    const e = esperando(c, agoraMs);
    if (e) saida.push(e);
  }
  return saida.sort(porEsperaMaisLonga);
}

export interface ResumoDasConversas {
  /** Abertas + pendentes atribuídas à pessoa, grupos incluídos, no escopo do perfil. */
  atribuidas: number;
  /**
   * Atribuídas num número FORA do perfil (D8/D5 do plano): contadas à parte e
   * sem link — a caixa de entrada as esconde, e omiti-las aqui calaria uma
   * obrigação atribuída à pessoa.
   */
  foraDoPerfil: number;
  /** As do escopo com cliente esperando há 10 min ou mais, mais antiga primeiro. */
  esperando: ConversaEsperando[];
}

export function resumirConversas(
  conversas: readonly Conversation[],
  ctx: ContextoDeAcesso,
  agoraMs: number
): ResumoDasConversas {
  const saida: ResumoDasConversas = {
    atribuidas: 0,
    foraDoPerfil: 0,
    esperando: conversasEsperando(conversas, ctx, agoraMs),
  };
  for (const c of conversas) {
    if (c.status === 'closed') continue;
    if (!conversaNoEscopo(ctx, c)) saida.foraDoPerfil++;
    else saida.atribuidas++;
  }
  return saida;
}

// ------------------------------------------------------------
// Fila sem responsável
// ------------------------------------------------------------

export interface ResumoDaFila {
  /** Começaram a esperar depois da última confirmação, mais antiga primeiro. */
  novas: ConversaEsperando[];
  /** Já esperavam antes dela (o acervo). */
  antigas: number;
  /** A espera mais longa de toda a fila no escopo, para a frase do acumulado. */
  maisAntiga: Atraso | null;
}

export function resumirFila(
  conversas: readonly Conversation[],
  ctx: ContextoDeAcesso,
  agoraMs: number,
  desdeMs: number
): ResumoDaFila {
  const todas: ConversaEsperando[] = [];
  for (const c of conversas) {
    if (c.assigned_agent_id || c.status === 'closed') continue;
    if (!conversaNoEscopo(ctx, c)) continue;
    const e = esperando(c, agoraMs);
    if (e) todas.push(e);
  }
  todas.sort(porEsperaMaisLonga);
  const novas = todas.filter(
    (e) => Date.parse(e.conversa.aguardando_desde!) >= desdeMs
  );
  return {
    novas,
    antigas: todas.length - novas.length,
    maisAntiga: todas[0]?.atraso ?? null,
  };
}
