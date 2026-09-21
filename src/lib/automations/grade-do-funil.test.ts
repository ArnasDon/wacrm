import { describe, expect, it } from 'vitest'
import type { Automation, AutomationStep } from '@/types'

import {
  cartoesDeChegada,
  cartoesDeEscopo,
  etapasParaOndeLeva,
  montarGrade,
  trechosContinuos,
} from './grade-do-funil'

// ------------------------------------------------------------
// A posição do cartão na grade é uma AFIRMAÇÃO sobre onde a regra roda.
// Cartão largo demais diz que a automação vale numa etapa em que ela não
// vale — e o operador não tem como desconfiar, porque a tela desenhou.
// ------------------------------------------------------------

const ETAPAS = ['e0', 'e1', 'e2', 'e3', 'e4']

const auto = (id: string, stage_ids?: string[] | null): Automation =>
  ({
    id,
    name: id,
    trigger_type: 'deal_stage_changed',
    trigger_config: stage_ids === null ? {} : { stage_ids },
    is_active: true,
  }) as unknown as Automation

describe('trechosContinuos', () => {
  it('colunas vizinhas viram um trecho só', () => {
    expect(trechosContinuos([1, 2, 3])).toEqual([{ inicio: 1, tamanho: 3 }])
  })

  it('CRÍTICO: coluna 1 e 3 NÃO viram um retângulo de 1 a 3', () => {
    // Um retângulo daqui até ali afirmaria que a regra vale na 2. Ela não
    // vale. Dois trechos, cada um verdadeiro.
    expect(trechosContinuos([1, 3])).toEqual([
      { inicio: 1, tamanho: 1 },
      { inicio: 3, tamanho: 1 },
    ])
  })

  it('ordena e remove repetido antes de agrupar', () => {
    expect(trechosContinuos([3, 1, 2, 1])).toEqual([{ inicio: 1, tamanho: 3 }])
  })

  it('lista vazia devolve nada', () => {
    expect(trechosContinuos([])).toEqual([])
  })
})

describe('montarGrade — largura do cartão', () => {
  it('uma etapa ocupa uma coluna', () => {
    const g = montarGrade([auto('a', ['e2'])], ETAPAS)
    expect(g).toHaveLength(1)
    expect(g[0][0]).toMatchObject({ colunaInicial: 2, colunas: 1, todasAsEtapas: false })
  })

  it('três etapas vizinhas atravessam três colunas', () => {
    const g = montarGrade([auto('a', ['e1', 'e2', 'e3'])], ETAPAS)
    expect(g[0][0]).toMatchObject({ colunaInicial: 1, colunas: 3 })
  })

  it('CRÍTICO: sem etapa escolhida ocupa o quadro INTEIRO', () => {
    // É o "Webhook" que atravessa a tela no Kommo, e o grupo "De todas as
    // etapas" do painel. Desenhar isso como um cartão de uma coluna só
    // esconderia que a regra dispara em todas.
    const g = montarGrade([auto('a', null)], ETAPAS)
    expect(g[0][0]).toMatchObject({
      colunaInicial: 0,
      colunas: 5,
      todasAsEtapas: true,
    })
  })

  it('lista vazia de etapas conta como sem escolha', () => {
    const g = montarGrade([auto('a', [])], ETAPAS)
    expect(g[0][0]).toMatchObject({ colunas: 5, todasAsEtapas: true })
  })

  it('etapas não vizinhas viram DOIS cartões da mesma automação', () => {
    const g = montarGrade([auto('a', ['e0', 'e3'])], ETAPAS)
    const cartoes = g.flat()
    expect(cartoes).toHaveLength(2)
    expect(cartoes.map((c) => c.colunaInicial).sort()).toEqual([0, 3])
    // Os dois precisam avisar que há mais da mesma regra em outro lugar.
    expect(cartoes.every((c) => c.temOutrosTrechos)).toBe(true)
  })
})

describe('montarGrade — o que NÃO entra', () => {
  it('outro tipo de gatilho fica fora', () => {
    const a = auto('a', ['e1'])
    ;(a as { trigger_type: string }).trigger_type = 'keyword_match'
    expect(montarGrade([a], ETAPAS)).toEqual([])
  })

  it('automação de OUTRO funil some deste quadro', () => {
    expect(montarGrade([auto('a', ['zzz'])], ETAPAS)).toEqual([])
  })

  it('CRÍTICO: cobre este funil E outro → aparece, marcada', () => {
    // Some daqui seria pior: a regra dispara nesta etapa e o quadro diria
    // que não há nada. Aparece, e o cartão avisa que há mais fora.
    const g = montarGrade([auto('a', ['e1', 'de-outro-funil'])], ETAPAS)
    expect(g.flat()).toHaveLength(1)
    expect(g.flat()[0]).toMatchObject({ colunaInicial: 1, colunas: 1, temOutrosTrechos: true })
  })

  it('quadro sem etapa nenhuma não inventa cartão de largura zero', () => {
    expect(montarGrade([auto('a', null)], [])).toEqual([])
  })
})

describe('montarGrade — empilhamento em linhas', () => {
  it('cartões que não se tocam dividem a mesma linha', () => {
    const g = montarGrade([auto('a', ['e0']), auto('b', ['e3'])], ETAPAS)
    expect(g).toHaveLength(1)
    expect(g[0]).toHaveLength(2)
  })

  it('CRÍTICO: cartões que disputam a mesma coluna vão para linhas diferentes', () => {
    const g = montarGrade([auto('a', ['e1']), auto('b', ['e1'])], ETAPAS)
    expect(g).toHaveLength(2)
    expect(g[0][0].automation.id).toBe('a')
    expect(g[1][0].automation.id).toBe('b')
  })

  it('sobreposição PARCIAL também separa', () => {
    // e1-e2 e e2-e3 dividem a e2. Na mesma linha, um cobriria o outro.
    const g = montarGrade([auto('a', ['e1', 'e2']), auto('b', ['e2', 'e3'])], ETAPAS)
    expect(g).toHaveLength(2)
  })

  it('a de largura total empurra a seguinte para baixo', () => {
    const g = montarGrade([auto('todas', null), auto('b', ['e0'])], ETAPAS)
    expect(g).toHaveLength(2)
    expect(g[0][0].todasAsEtapas).toBe(true)
  })

  it('a terceira reaproveita a primeira linha se couber', () => {
    // a=[e0], b=[e0] (vai para a linha 2), c=[e4] cabe de volta na linha 1.
    const g = montarGrade([auto('a', ['e0']), auto('b', ['e0']), auto('c', ['e4'])], ETAPAS)
    expect(g).toHaveLength(2)
    expect(g[0].map((x) => x.automation.id)).toEqual(['a', 'c'])
  })

  it('preserva a ordem em que as automações chegaram', () => {
    // A ordem da lista é a que o operador já viu na tela de automações;
    // reordenar por "esperteza" faria o mesmo funil parecer outro.
    const g = montarGrade([auto('z', ['e0']), auto('y', ['e1'])], ETAPAS)
    expect(g[0].map((c) => c.automation.id)).toEqual(['z', 'y'])
  })
})

// ------------------------------------------------------------
// Cartões de CHEGADA (07/09/2026): automação de outro gatilho que LEVA o
// card para uma etapa deste quadro — o caso do Calendly.
// ------------------------------------------------------------

const outroGatilho = (id: string, trigger_type = 'calendly_booking'): Automation =>
  ({ id, name: id, trigger_type, trigger_config: {}, is_active: true }) as unknown as Automation

const passo = (automation_id: string, step_type: string, step_config: Record<string, unknown>): AutomationStep =>
  ({ id: `${automation_id}-${step_type}`, automation_id, step_type, step_config, position: 0 }) as unknown as AutomationStep

describe('cartões de chegada', () => {
  const posicao = new Map(ETAPAS.map((id, i) => [id, i]))

  it('move_deal_stage para uma etapa do quadro vira um cartão de UMA coluna naquela etapa', () => {
    const cal = outroGatilho('cal')
    const steps = { cal: [passo('cal', 'update_contact_field', { field: 'name' }), passo('cal', 'move_deal_stage', { stage_id: 'e2' })] }
    const cartoes = cartoesDeChegada([cal], steps, posicao)
    expect(cartoes).toEqual([
      { automation: cal, tipo: 'chegada', colunaInicial: 2, colunas: 1, todasAsEtapas: false, temOutrosTrechos: false },
    ])
  })

  it('create_deal também é chegada; etapa de OUTRO funil não vira cartão', () => {
    const a = outroGatilho('a', 'keyword_match')
    const steps = { a: [passo('a', 'create_deal', { pipeline_id: 'p', stage_id: 'e0' }), passo('a', 'move_deal_stage', { stage_id: 'de-outro-funil' })] }
    expect(etapasParaOndeLeva(steps.a, posicao)).toEqual([0])
    expect(cartoesDeChegada([a], steps, posicao).map((c) => c.colunaInicial)).toEqual([0])
  })

  it('dois destinos = dois cartões; o mesmo destino duas vezes = um', () => {
    const a = outroGatilho('a')
    const steps = { a: [passo('a', 'move_deal_stage', { stage_id: 'e1' }), passo('a', 'move_deal_stage', { stage_id: 'e3' }), passo('a', 'move_deal_stage', { stage_id: 'e1' })] }
    expect(cartoesDeChegada([a], steps, posicao).map((c) => c.colunaInicial)).toEqual([1, 3])
  })

  it('CRÍTICO: automação de gatilho de etapa NÃO ganha cartão de chegada (já tem o do gatilho)', () => {
    const esteira = auto('esteira', ['e0'])
    const steps = { esteira: [passo('esteira', 'move_deal_stage', { stage_id: 'e1' })] }
    expect(cartoesDeChegada([esteira], steps, posicao)).toEqual([])
    const grade = montarGrade([esteira], ETAPAS, steps)
    expect(grade.flat().map((c) => c.tipo)).toEqual(['gatilho'])
  })

  it('CRÍTICO: gatilho que NUNCA dispara (time_based, conversation_assigned) não ganha cartão de chegada', () => {
    // Existem no banco desde o upstream sem call site nenhum (Codex, PR #131):
    // o cartão afirmaria "esta regra leva o card para cá" sobre regra que não roda.
    const steps = (id: string) => ({ [id]: [passo(id, 'move_deal_stage', { stage_id: 'e2' })] })
    expect(cartoesDeChegada([outroGatilho('t', 'time_based')], steps('t'), posicao)).toEqual([])
    expect(cartoesDeChegada([outroGatilho('c', 'conversation_assigned')], steps('c'), posicao)).toEqual([])
    // …e o MESMO passo num gatilho que dispara continua aparecendo.
    expect(cartoesDeChegada([outroGatilho('k', 'keyword_match')], steps('k'), posicao)).toHaveLength(1)
  })

  it('sem passos (ou automação que não move nada) não aparece', () => {
    const a = outroGatilho('a')
    expect(cartoesDeChegada([a], {}, posicao)).toEqual([])
    expect(cartoesDeChegada([a], { a: [passo('a', 'send_message', { text: 'oi' })] }, posicao)).toEqual([])
  })

  it('montarGrade empilha os de chegada junto com os de gatilho, sem sobrepor', () => {
    const gat = auto('gat', ['e2'])
    const cal = outroGatilho('cal')
    const steps = { cal: [passo('cal', 'move_deal_stage', { stage_id: 'e2' })] }
    const grade = montarGrade([gat, cal], ETAPAS, steps)
    // os dois querem a coluna 2: duas linhas
    expect(grade).toHaveLength(2)
    expect(grade[0][0]).toMatchObject({ automation: gat, tipo: 'gatilho' })
    expect(grade[1][0]).toMatchObject({ automation: cal, tipo: 'chegada', colunaInicial: 2 })
  })

  it('todo cartão de gatilho carrega `tipo: gatilho` (compat com a tela)', () => {
    expect(montarGrade([auto('x', null)], ETAPAS).flat().every((c) => c.tipo === 'gatilho')).toBe(true)
  })
})

// ------------------------------------------------------------
// Cartões de ESCOPO (20/09/2026). Os quatro lembretes de reunião do
// escritório disparam pelo RELÓGIO e são presos a "Reunião Agendada" pelo
// escopo — rodavam no funil e não apareciam na aba dele, então não havia
// onde arrastar, expandir, duplicar nem ligar. A armadilha é a lista: o
// escopo é `automations.stage_ids`, NÃO `trigger_config.stage_ids`.
// ------------------------------------------------------------

const comEscopo = (
  id: string,
  stage_ids: string[] | null,
  trigger_type = 'date_field_offset',
): Automation =>
  ({
    id,
    name: id,
    trigger_type,
    trigger_config: {},
    stage_ids,
    is_active: true,
  }) as unknown as Automation

describe('cartões de escopo', () => {
  const posicao = new Map(ETAPAS.map((id, i) => [id, i]))

  it('o lembrete preso a uma etapa vira cartão NAQUELA coluna', () => {
    const lembrete = comEscopo('lembrete', ['e2'])
    expect(cartoesDeEscopo([lembrete], posicao)).toEqual([
      { automation: lembrete, tipo: 'escopo', colunaInicial: 2, colunas: 1, todasAsEtapas: false, temOutrosTrechos: false },
    ])
  })

  it('CRÍTICO: a largura sai de `automations.stage_ids`, nunca de `trigger_config.stage_ids`', () => {
    // As duas listas têm significados OPOSTOS. Ler a errada põe o cartão na
    // coluna errada afirmando o que o motor não faz.
    const a = {
      id: 'a',
      name: 'a',
      trigger_type: 'date_field_offset',
      trigger_config: { stage_ids: ['e0'] },
      stage_ids: ['e3'],
      is_active: true,
    } as unknown as Automation
    expect(cartoesDeEscopo([a], posicao).map((c) => c.colunaInicial)).toEqual([3])
  })

  it('etapas vizinhas viram um cartão largo; não vizinhas viram dois, com aviso', () => {
    expect(cartoesDeEscopo([comEscopo('a', ['e1', 'e2'])], posicao)).toMatchObject([
      { colunaInicial: 1, colunas: 2, temOutrosTrechos: false },
    ])
    expect(cartoesDeEscopo([comEscopo('b', ['e0', 'e3'])], posicao)).toMatchObject([
      { colunaInicial: 0, colunas: 1, temOutrosTrechos: true },
      { colunaInicial: 3, colunas: 1, temOutrosTrechos: true },
    ])
  })

  it('etapa de OUTRO funil não desenha aqui, mas acende o aviso', () => {
    expect(cartoesDeEscopo([comEscopo('a', ['e1', 'de-outro-funil'])], posicao)).toMatchObject([
      { colunaInicial: 1, colunas: 1, temOutrosTrechos: true },
    ])
    // só etapas de fora: some deste quadro
    expect(cartoesDeEscopo([comEscopo('b', ['de-outro-funil'])], posicao)).toEqual([])
  })

  it('CRÍTICO: escopo VAZIO não vira cartão — vazio não é "todas as etapas" no desenho', () => {
    // A convenção do projeto ("vazio = todas") vale para o MOTOR. Aqui, um
    // cartão de largura total por automação sem escopo encheria a aba com
    // toda cobrança do Asaas e toda regra manual da conta.
    expect(cartoesDeEscopo([comEscopo('a', null)], posicao)).toEqual([])
    expect(cartoesDeEscopo([comEscopo('b', [])], posicao)).toEqual([])
  })

  it('CRÍTICO: automação de gatilho de etapa NÃO ganha cartão de escopo (já tem o do gatilho)', () => {
    const a = {
      id: 'a',
      name: 'a',
      trigger_type: 'deal_stage_changed',
      trigger_config: { stage_ids: ['e0'] },
      stage_ids: ['e4'],
      is_active: true,
    } as unknown as Automation
    expect(cartoesDeEscopo([a], posicao)).toEqual([])
    expect(montarGrade([a], ETAPAS).flat().map((c) => c.tipo)).toEqual(['gatilho'])
  })

  it('CRÍTICO: gatilho que NUNCA dispara não ganha cartão de escopo', () => {
    expect(cartoesDeEscopo([comEscopo('t', ['e1'], 'time_based')], posicao)).toEqual([])
    expect(cartoesDeEscopo([comEscopo('c', ['e1'], 'conversation_assigned')], posicao)).toEqual([])
  })

  it('CRÍTICO: a MESMA automação pode ter chegada E escopo na MESMA coluna', () => {
    // É o que obriga a chave do React a incluir o TIPO (Codex, PR #234): sem
    // ele, os dois cartões viram chaves irmãs iguais e um pode sumir no
    // redesenho. Os dois são verdadeiros e dizem coisas diferentes — "leva o
    // card para cá" e "só roda enquanto ele está aqui".
    const a = {
      id: 'dupla',
      name: 'dupla',
      trigger_type: 'calendly_booking',
      trigger_config: {},
      stage_ids: ['e2'],
      is_active: true,
    } as unknown as Automation
    const steps = { dupla: [passo('dupla', 'move_deal_stage', { stage_id: 'e2' })] }
    const cartoes = montarGrade([a], ETAPAS, steps).flat()
    expect(cartoes).toHaveLength(2)
    expect(cartoes.map((c) => c.tipo).sort()).toEqual(['chegada', 'escopo'])
    // mesma automação, mesma coluna: só o tipo os distingue
    expect(new Set(cartoes.map((c) => `${c.automation.id}-${c.colunaInicial}`)).size).toBe(1)
    expect(new Set(cartoes.map((c) => `${c.automation.id}-${c.tipo}-${c.colunaInicial}`)).size).toBe(2)
  })

  it('montarGrade empilha escopo, gatilho e chegada sem sobrepor', () => {
    const gat = auto('gat', ['e2'])
    const cal = outroGatilho('cal')
    const lembrete = comEscopo('lembrete', ['e2'])
    const steps = { cal: [passo('cal', 'move_deal_stage', { stage_id: 'e2' })] }
    const grade = montarGrade([gat, cal, lembrete], ETAPAS, steps)
    expect(grade).toHaveLength(3)
    expect(grade.flat().map((c) => c.tipo)).toEqual(['gatilho', 'chegada', 'escopo'])
    // ninguém disputa a mesma célula
    expect(new Set(grade.flat().map((c) => c.colunaInicial))).toEqual(new Set([2]))
  })
})
