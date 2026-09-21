import type { Automation, AutomationStep, DealStageTriggerConfig } from '@/types'

import { GATILHOS_SEM_DISPARO } from './trigger-meta'

/**
 * A GRADE de automações do funil — colunas são etapas, cartões ocupam as
 * colunas em que a automação dispara (estilo Kommo).
 *
 * Puro e fora da tela pelo mesmo motivo de `por-etapa.ts`: a posição do cartão
 * é uma AFIRMAÇÃO sobre onde a regra roda, e afirmação errada aqui é a tela
 * mentindo com cara de certa.
 *
 * ⚠️ "Expandir" o cartão para mais colunas é gravar mais etapas em
 * `trigger_config.stage_ids`. Não há coluna nova, nem migration: a largura do
 * cartão É o conteúdo daquele campo. Vazio = ocupa o funil inteiro.
 *
 * Três TIPOS de cartão, e a diferença é o que a posição afirma:
 *   - `gatilho`: "dispara quando o card ENTRA nesta(s) etapa(s)" — a
 *     largura é `trigger_config.stage_ids`.
 *   - `chegada`: "dispara em OUTRO lugar (Calendly, palavra-chave, tag…) e
 *     LEVA o card para esta etapa" — a posição é o `stage_id` de um passo
 *     `move_deal_stage`/`create_deal`. Sempre uma coluna, sem "expandir":
 *     mudar a etapa é editar o passo. Nasceu em 07/09/2026 porque a
 *     automação do Calendly, que move para "Reunião Agendada", não aparecia
 *     no funil, e o operador foi procurá-la lá.
 *   - `escopo`: "dispara pelo RELÓGIO (ou à mão) e só roda ENQUANTO o card
 *     está nesta(s) etapa(s)" — a largura é `automations.stage_ids`, a
 *     outra lista. Nasceu em 20/09/2026 pelo mesmo motivo do `chegada`: os
 *     quatro lembretes de reunião são presos a "Reunião Agendada" e não
 *     apareciam em funil nenhum, então não havia onde arrastar, expandir,
 *     duplicar nem ligar. A regra da casa é a do operador: toda automação
 *     que roda num funil aparece na aba daquele funil.
 */

export type TipoDoCartao = 'gatilho' | 'chegada' | 'escopo'

/** Um cartão já posicionado: onde começa, quantas colunas ocupa. */
export interface CartaoDaGrade {
  automation: Automation
  tipo: TipoDoCartao
  /** Índice da primeira coluna (0-based), na ordem das etapas do quadro. */
  colunaInicial: number
  /** Quantas colunas ele atravessa. Sempre ≥ 1. */
  colunas: number
  /**
   * A automação não escolheu etapa: vale para TODAS, inclusive as de outros
   * funis. Ocupa a largura toda deste quadro, mas o cartão precisa dizer isso
   * — senão o operador lê "vale destas 9 etapas" e edita achando que recorta
   * só o que está vendo.
   */
  todasAsEtapas: boolean
  /**
   * A automação cobre etapas fora deste trecho contínuo (ou fora deste funil).
   * Existe porque um cartão só desenha um retângulo, e etapas não vizinhas
   * viram vários cartões.
   */
  temOutrosTrechos: boolean
}

/** Uma faixa horizontal da grade. Cartões da mesma linha nunca se sobrepõem. */
export type LinhaDaGrade = CartaoDaGrade[]

/**
 * Trechos CONTÍNUOS de colunas que a automação cobre.
 *
 * ⚠️ Etapa 1 e 3, pulando a 2, NÃO pode virar um retângulo de 1 a 3 — isso
 * seria a tela afirmando que a regra vale na 2. Viram dois cartões, cada um
 * verdadeiro. É por isso que esta função devolve uma lista.
 */
export function trechosContinuos(indices: number[]): Array<{ inicio: number; tamanho: number }> {
  const ordenados = [...new Set(indices)].sort((a, b) => a - b)
  const trechos: Array<{ inicio: number; tamanho: number }> = []
  for (const i of ordenados) {
    const ultimo = trechos[trechos.length - 1]
    if (ultimo && i === ultimo.inicio + ultimo.tamanho) ultimo.tamanho += 1
    else trechos.push({ inicio: i, tamanho: 1 })
  }
  return trechos
}

/**
 * Monta a grade. `stageIds` vem na ORDEM das colunas do quadro — a ordem é
 * dado de entrada, não detalhe: é ela que decide o que é vizinho.
 *
 * Empilha em linhas de modo que dois cartões nunca disputem a mesma célula.
 * Primeiro-que-cabe, na ordem recebida: sem ordenação esperta, porque a ordem
 * das automações na tela é a que o operador já viu na lista.
 */
export function montarGrade(
  automations: Automation[],
  stageIds: string[],
  /** Passos por automação (planos, ramos incluídos). Sem eles, só os cartões de gatilho. */
  steps: Record<string, AutomationStep[]> = {},
): LinhaDaGrade[] {
  const posicao = new Map(stageIds.map((id, i) => [id, i]))
  const linhas: LinhaDaGrade[] = []

  const empilhar = (cartao: CartaoDaGrade) => {
    const linha = linhas.find((l) => cabeNaLinha(l, cartao))
    if (linha) linha.push(cartao)
    else linhas.push([cartao])
  }

  for (const a of automations) {
    if (a.trigger_type !== 'deal_stage_changed') continue

    const alvo = (a.trigger_config as DealStageTriggerConfig | undefined)?.stage_ids
    const semEscolha = !Array.isArray(alvo) || alvo.length === 0

    let cartoes: Array<Omit<CartaoDaGrade, 'automation' | 'tipo'>>
    if (semEscolha) {
      // Sem etapa escolhida = todas. Ocupa a largura do quadro.
      if (stageIds.length === 0) continue
      cartoes = [
        {
          colunaInicial: 0,
          colunas: stageIds.length,
          todasAsEtapas: true,
          temOutrosTrechos: false,
        },
      ]
    } else {
      const daqui = alvo.map((id) => posicao.get(id)).filter((i): i is number => i !== undefined)
      // Etapa de OUTRO funil (ou apagada) não aparece neste quadro. Se sobrou
      // nada, a automação não pertence a este funil — some da grade.
      if (daqui.length === 0) continue
      const trechos = trechosContinuos(daqui)
      // "Tem outros trechos" cobre os dois casos: etapa em outro funil
      // (`alvo` maior que `daqui`) e etapa não vizinha aqui mesmo.
      const foraDaqui = alvo.length > daqui.length
      cartoes = trechos.map((t) => ({
        colunaInicial: t.inicio,
        colunas: t.tamanho,
        todasAsEtapas: false,
        temOutrosTrechos: foraDaqui || trechos.length > 1,
      }))
    }

    for (const c of cartoes) empilhar({ automation: a, tipo: 'gatilho', ...c })
  }

  for (const c of cartoesDeChegada(automations, steps, posicao)) empilhar(c)
  for (const c of cartoesDeEscopo(automations, posicao)) empilhar(c)

  return linhas
}

/**
 * Para que etapas DESTE quadro uma automação leva o card. Só os passos que
 * escrevem etapa: `move_deal_stage` e `create_deal` (que nasce numa etapa).
 * Passo dentro de ramo conta — "pode chegar aqui" é verdade mesmo condicional.
 */
export function etapasParaOndeLeva(passos: AutomationStep[] | undefined, posicao: Map<string, number>): number[] {
  const indices: number[] = []
  for (const p of passos ?? []) {
    if (p.step_type !== 'move_deal_stage' && p.step_type !== 'create_deal') continue
    const stageId = (p.step_config as { stage_id?: unknown } | undefined)?.stage_id
    const i = typeof stageId === 'string' ? posicao.get(stageId) : undefined
    if (i !== undefined) indices.push(i)
  }
  return [...new Set(indices)].sort((a, b) => a - b)
}

/**
 * Os cartões de CHEGADA: automações de outro gatilho que movem o card para
 * uma etapa deste quadro. A de gatilho de etapa fica de fora de propósito —
 * ela já tem cartão pela largura do gatilho, e um segundo cartão pela etapa
 * de destino faria uma esteira de 5 regras virar 10 cartões. Gatilho que
 * NUNCA dispara (`GATILHOS_SEM_DISPARO`: `time_based`, `conversation_assigned`,
 * sem call site) também fica de fora: o cartão afirmaria "esta regra leva o
 * card para cá" sobre regra que não roda (Codex, PR #131).
 */
export function cartoesDeChegada(
  automations: Automation[],
  steps: Record<string, AutomationStep[]>,
  posicao: Map<string, number>,
): CartaoDaGrade[] {
  const cartoes: CartaoDaGrade[] = []
  for (const a of automations) {
    if (a.trigger_type === 'deal_stage_changed' || GATILHOS_SEM_DISPARO.has(a.trigger_type)) continue
    for (const i of etapasParaOndeLeva(steps[a.id], posicao)) {
      cartoes.push({
        automation: a,
        tipo: 'chegada',
        colunaInicial: i,
        colunas: 1,
        todasAsEtapas: false,
        temOutrosTrechos: false,
      })
    }
  }
  return cartoes
}

/**
 * Os cartões de ESCOPO: automações que não nascem de um evento de funil, mas
 * que só rodam ENQUANTO o card está numa etapa dele
 * (`automations.stage_ids`). O caso que motivou: os lembretes de reunião,
 * que disparam pelo relógio (`date_field_offset`) e são presos a "Reunião
 * Agendada" — eles rodam no funil e não apareciam na aba dele.
 *
 * ⚠️⚠️ A largura aqui é `automations.stage_ids`, NUNCA
 * `trigger_config.stage_ids`. São as duas listas de significado oposto desta
 * casa ("em qual etapa o contato precisa ESTAR" × "para qual etapa o card
 * tem de ENTRAR"), e trocá-las põe o cartão na coluna errada afirmando uma
 * coisa que o motor não faz. Quem editar isto lê `por-etapa.ts` antes.
 *
 * ⚠️ ESCOPO VAZIO NÃO VIRA CARTÃO, e aqui a convenção "vazio = todas" NÃO se
 * aplica ao desenho: vazio quer dizer que a automação não tem relação
 * nenhuma com etapa, e um cartão de largura total por automação sem escopo
 * encheria a aba de toda cobrança do Asaas e de toda regra manual da conta.
 * Cartão é afirmação; "não tem relação com este funil" se afirma NÃO
 * desenhando.
 *
 * ⚠️ Automação de gatilho de etapa fica de fora: ela já tem o cartão do
 * gatilho. Quando o escopo dela diverge do gatilho, o resultado é a
 * combinação "nunca dispara aqui", que o painel da coluna já nomeia
 * (`por-etapa.ts`, classe `morta`) — desenhar um segundo cartão diria que
 * ela roda numa etapa em que ela justamente não roda.
 *
 * ⚠️ Gatilho sem call site (`GATILHOS_SEM_DISPARO`) também fica de fora,
 * pela mesma razão do `chegada`: regra que não roda não é desenhada.
 */
export function cartoesDeEscopo(
  automations: Automation[],
  posicao: Map<string, number>,
): CartaoDaGrade[] {
  const cartoes: CartaoDaGrade[] = []
  for (const a of automations) {
    if (a.trigger_type === 'deal_stage_changed' || GATILHOS_SEM_DISPARO.has(a.trigger_type)) continue

    const escopo = a.stage_ids
    if (!Array.isArray(escopo) || escopo.length === 0) continue

    const daqui = escopo.map((id) => posicao.get(id)).filter((i): i is number => i !== undefined)
    if (daqui.length === 0) continue

    const trechos = trechosContinuos(daqui)
    const foraDaqui = escopo.length > daqui.length
    for (const t of trechos) {
      cartoes.push({
        automation: a,
        tipo: 'escopo',
        colunaInicial: t.inicio,
        colunas: t.tamanho,
        todasAsEtapas: false,
        temOutrosTrechos: foraDaqui || trechos.length > 1,
      })
    }
  }
  return cartoes
}

function cabeNaLinha(linha: LinhaDaGrade, novo: CartaoDaGrade): boolean {
  return !linha.some(
    (c) =>
      novo.colunaInicial < c.colunaInicial + c.colunas &&
      c.colunaInicial < novo.colunaInicial + novo.colunas,
  )
}
