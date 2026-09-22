// ============================================================
// Quem atende cada reunião (migration 945).
//
// O dado sempre existiu — `cb_meetings.owner_user_id` e `owner_nome` são
// gravados desde a Fase 1 — mas não aparecia em lugar nenhum da tela. Com dois
// advogados na mesma conta, olhar a agenda não dizia de quem era o quê.
//
// ⚠️ A REGRA DE EXIBIÇÃO É DERIVADA DAS PRÓPRIAS REUNIÕES, não da lista de
// membros da conta. A lista vem de `/api/account/members`, que devolve `[]` em
// qualquer falha — condicionar a ela faz o nome sumir da tela por causa de uma
// requisição que falhou, e o operador lê isso como "não há responsável". O
// número de responsáveis DISTINTOS entre as reuniões carregadas responde
// exatamente à pergunta certa: "preciso distinguir?".
// ============================================================

import type { Meeting } from '@/types';

/** Marca do filtro "qualquer advogado" — a ausência de recorte. */
export const TODOS = '__todos__';

/**
 * Quantos responsáveis diferentes aparecem nestas reuniões.
 *
 * Reunião órfã (advogado que saiu da conta, `owner_user_id` nulo) conta como
 * um responsável próprio: ela ainda precisa ser distinguida das outras, e o
 * `owner_nome` carimbado diz de quem era.
 */
export function responsaveisDistintos(reunioes: Meeting[]): number {
  return new Set(reunioes.map((r) => r.owner_user_id ?? `orfa:${r.owner_nome}`))
    .size;
}

/**
 * O nome do responsável cabe no cartão?
 *
 * Só quando distingue alguma coisa. Num escritório de um advogado só, repetir
 * o mesmo nome em cada retângulo da agenda é ruído puro — e o cartão do mês
 * tem largura para pouco mais que o horário.
 */
export function mostrarResponsavel(reunioes: Meeting[]): boolean {
  return responsaveisDistintos(reunioes) > 1;
}

/**
 * O primeiro nome, que é o que cabe no cartão.
 *
 * Num escritório as pessoas se chamam pelo primeiro nome, e "Leonardo" recorta
 * melhor que "Rodrigo Tavares Mont…".
 */
export function primeiroNome(nome: string): string {
  const limpo = nome.trim();
  if (!limpo) return '';
  return limpo.split(/\s+/)[0];
}

/**
 * Recorta por responsável. `TODOS` (ou vazio) não recorta nada — mesma
 * convenção de escopo do resto do projeto, onde vazio significa "tudo".
 */
export function filtrarPorResponsavel(
  reunioes: Meeting[],
  responsavel: string,
): Meeting[] {
  if (!responsavel || responsavel === TODOS) return reunioes;
  return reunioes.filter((r) => r.owner_user_id === responsavel);
}
